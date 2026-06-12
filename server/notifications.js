import { query } from './db.js';
import { firebaseMessaging } from './firebase.js';

const appointmentNotificationTitle = 'Nova manuten\u00e7\u00e3o agendada!';

function formatDateBr(value) {
  if (!value) {
    return '-';
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  return text;
}

async function systemLog(level, message, context = {}) {
  try {
    await query(
      `INSERT INTO system_logs (level, message, context)
       VALUES ($1, $2, $3)`,
      [level, message, JSON.stringify(context)],
    );
  } catch (error) {
    console.error('Falha ao registrar log de notificacao.', error);
  }
}

export function buildAppointmentScheduledNotification(record) {
  const clientName = String(record.clientName || record.client_name || 'CLIENTE').trim() || 'CLIENTE';
  const visitDate = record.visitDate || record.visit_date || null;
  const formattedDate = formatDateBr(visitDate);

  return {
    type: 'appointment-created',
    title: appointmentNotificationTitle,
    body: `-${clientName}, ${formattedDate}-`,
    clientName,
    visitDate,
    formattedDate,
    appointmentId: String(record.id || ''),
  };
}

export async function sendAppointmentScheduledNotification(record, options = {}) {
  const notification = buildAppointmentScheduledNotification(record);
  const messaging = firebaseMessaging();

  if (!messaging) {
    await systemLog('info', 'Notificacao de agendamento sem envio FCM', {
      reason: 'firebase-not-configured',
      notification,
    });
    return { notification, sent: 0, failed: 0, skipped: 0 };
  }

  const { rows } = await query(
    `SELECT DISTINCT token, user_id
     FROM fcm_tokens
     WHERE token <> ''`,
  );
  const excludeToken = String(options.excludeToken || '').trim();
  const excludeUserId = String(options.excludeUserId || '').trim();
  const tokens = [
    ...new Set(
      rows
        .filter((row) => row.token !== excludeToken)
        .filter((row) => !excludeUserId || row.user_id !== excludeUserId)
        .map((row) => row.token)
        .filter(Boolean),
    ),
  ];

  if (!tokens.length) {
    await systemLog('info', 'Notificacao de agendamento sem tokens FCM disponiveis', {
      notification,
      excludedToken: Boolean(excludeToken),
      excludedUserId: Boolean(excludeUserId),
    });
    return { notification, sent: 0, failed: 0, skipped: rows.length };
  }

  let sent = 0;
  let failed = 0;

  for (let index = 0; index < tokens.length; index += 500) {
    const chunk = tokens.slice(index, index + 500);
    const result = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        type: notification.type,
        appointmentId: notification.appointmentId,
        clientName: notification.clientName,
        visitDate: notification.visitDate || '',
        formattedDate: notification.formattedDate,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'appointments',
          sound: 'default',
        },
      },
    });

    sent += result.successCount;
    failed += result.failureCount;
  }

  await systemLog('info', 'Notificacao de agendamento enviada', {
    sent,
    failed,
    totalTokens: tokens.length,
    notification,
  });

  return { notification, sent, failed, skipped: rows.length - tokens.length };
}
