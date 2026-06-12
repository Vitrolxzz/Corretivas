import 'dart:async';
import 'dart:convert';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'api_client.dart';

const _appointmentChannel = AndroidNotificationChannel(
  'appointments',
  'Agendamentos',
  description: 'Avisos de novas manutencoes agendadas.',
  importance: Importance.high,
);

@pragma('vm:entry-point')
Future<void> corretivasFirebaseMessagingBackgroundHandler(
  RemoteMessage message,
) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {
    // Firebase can be enabled later by adding the Android configuration file.
  }
}

class MobileNotificationService {
  MobileNotificationService._();

  static final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();
  static final StreamController<String> _tokenController =
      StreamController<String>.broadcast();
  static final Set<String> _shownKeys = <String>{};

  static StreamSubscription<String>? _tokenRefreshSubscription;
  static StreamSubscription<RemoteMessage>? _messageSubscription;
  static bool _initialized = false;
  static bool _localReady = false;
  static bool _firebaseReady = false;
  static String? _currentToken;

  static Stream<String> get tokenStream => _tokenController.stream;
  static String? get currentToken => _currentToken;

  static Future<void> initialize() async {
    if (_initialized) {
      return;
    }

    _initialized = true;
    await _setupLocalNotifications();
    await _setupFirebaseMessaging();
  }

  static Future<bool> registerToken(ApiClient api) async {
    if (!_initialized) {
      await initialize();
    }

    final token = _currentToken?.trim();

    if (!_firebaseReady || token == null || token.isEmpty) {
      return false;
    }

    api.notificationToken = token;
    await api.post('/fcm/tokens', {
      'token': token,
      'platform': 'android',
    });

    return true;
  }

  static Future<void> handleRealtimeEvent(
    Map<String, dynamic> event, {
    required String deviceId,
  }) async {
    final notification = event['notification'];

    if (notification is! Map) {
      return;
    }

    final sourceDeviceId = event['sourceDeviceId']?.toString() ?? '';

    if (sourceDeviceId.isNotEmpty && sourceDeviceId == deviceId) {
      return;
    }

    final payload = Map<String, dynamic>.from(notification);

    if (payload['type'] == 'appointment-created') {
      await showAppointmentNotification(payload);
    }
  }

  static Future<void> showAppointmentNotification(
    Map<String, dynamic> notification,
  ) async {
    if (!_initialized) {
      await initialize();
    }

    if (!_localReady) {
      return;
    }

    final key = _notificationKey(notification);

    if (!_rememberShownKey(key)) {
      return;
    }

    final title = notification['title']?.toString().trim().isNotEmpty == true
        ? notification['title'].toString()
        : 'Nova manuten\u00e7\u00e3o agendada!';
    final body = notification['body']?.toString().trim().isNotEmpty == true
        ? notification['body'].toString()
        : _defaultAppointmentBody(notification);

    await _localNotifications.show(
      id: _notificationId(key),
      title: title,
      body: body,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails(
          'appointments',
          'Agendamentos',
          channelDescription: 'Avisos de novas manutencoes agendadas.',
          importance: Importance.high,
          priority: Priority.high,
          playSound: true,
        ),
      ),
      payload: jsonEncode(notification),
    );
  }

  static Future<void> _setupLocalNotifications() async {
    try {
      const androidSettings = AndroidInitializationSettings('ic_launcher');
      const settings = InitializationSettings(android: androidSettings);

      await _localNotifications.initialize(settings: settings);

      final androidImplementation =
          _localNotifications.resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>();

      await androidImplementation?.createNotificationChannel(
        _appointmentChannel,
      );
      await androidImplementation?.requestNotificationsPermission();

      _localReady = true;
    } catch (_) {
      _localReady = false;
    }
  }

  static Future<void> _setupFirebaseMessaging() async {
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(
        corretivasFirebaseMessagingBackgroundHandler,
      );

      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission(alert: true, badge: true, sound: true);
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );

      _currentToken = await messaging.getToken();

      if (_currentToken?.trim().isNotEmpty == true) {
        _tokenController.add(_currentToken!.trim());
      }

      _tokenRefreshSubscription =
          messaging.onTokenRefresh.listen((String token) {
        _currentToken = token;
        _tokenController.add(token);
      });

      _messageSubscription = FirebaseMessaging.onMessage.listen(
        _showRemoteMessage,
      );

      _firebaseReady = true;
    } catch (_) {
      _firebaseReady = false;
    }
  }

  static Future<void> _showRemoteMessage(RemoteMessage message) async {
    final data = <String, dynamic>{...message.data};

    if (data['type'] != 'appointment-created') {
      return;
    }

    await showAppointmentNotification({
      'type': data['type'],
      'appointmentId': data['appointmentId'],
      'clientName': data['clientName'],
      'visitDate': data['visitDate'],
      'formattedDate': data['formattedDate'],
      'title':
          message.notification?.title ?? 'Nova manuten\u00e7\u00e3o agendada!',
      'body': message.notification?.body ?? _defaultAppointmentBody(data),
    });
  }

  static String _defaultAppointmentBody(Map<String, dynamic> notification) {
    final clientName =
        notification['clientName']?.toString().trim().isNotEmpty == true
            ? notification['clientName'].toString().trim()
            : 'CLIENTE';
    final formattedDate =
        notification['formattedDate']?.toString().trim().isNotEmpty == true
            ? notification['formattedDate'].toString().trim()
            : (notification['visitDate']?.toString().trim().isNotEmpty == true
                ? notification['visitDate'].toString().trim()
                : '-');

    return '-$clientName, $formattedDate-';
  }

  static String _notificationKey(Map<String, dynamic> notification) {
    final id = notification['appointmentId']?.toString().trim();

    if (id != null && id.isNotEmpty) {
      return 'appointment-created:$id';
    }

    return [
      'appointment-created',
      notification['clientName'],
      notification['visitDate'],
      notification['formattedDate'],
    ].map((value) => value?.toString() ?? '').join(':');
  }

  static bool _rememberShownKey(String key) {
    if (_shownKeys.contains(key)) {
      return false;
    }

    _shownKeys.add(key);

    if (_shownKeys.length > 80) {
      _shownKeys.remove(_shownKeys.first);
    }

    return true;
  }

  static int _notificationId(String key) {
    var hash = 0;

    for (final unit in key.codeUnits) {
      hash = ((hash * 31) + unit) & 0x7fffffff;
    }

    return hash == 0 ? 1 : hash;
  }

  static Future<void> dispose() async {
    await _tokenRefreshSubscription?.cancel();
    await _messageSubscription?.cancel();
    await _tokenController.close();
  }
}
