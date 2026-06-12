# Ecossistema Corretivas: Web + Android + API + Firebase

## Visao geral

O sistema passa a ser organizado como um ecossistema unico:

```text
Sistema Web        Aplicativo Android
     |                    |
     +------ API v1 ------+
              |
           Firebase
```

Nenhum cliente acessa o Firebase diretamente. Web e Android conversam apenas com a API centralizada.

## Componentes

- Web: React/Vite existente, preservado.
- Android: Flutter em `mobile/corretivas_app`.
- API centralizada: Express em `/api/v1`.
- Firebase Authentication: login, sessao, recuperacao de senha e perfis.
- Cloud Firestore: dados operacionais.
- Firebase Storage: fotos e anexos.
- FCM: estrutura para registrar tokens e disparar notificacoes push.

## Ativacao Firebase

Configure `.env`:

```text
DATA_BACKEND=firebase
API_V1_REQUIRE_AUTH=true
APP_JWT_SECRET=<segredo forte>
FIREBASE_PROJECT_ID=<projeto>
FIREBASE_STORAGE_BUCKET=<bucket>.appspot.com
FIREBASE_WEB_API_KEY=<web api key>
FIREBASE_SERVICE_ACCOUNT_PATH=C:\seguro\firebase-service-account.json
```

Sem essas credenciais, a API v1 usa SQLite como fallback para desenvolvimento e validacao local.

## Colecoes Firestore

- `periodos`
- `clientes`
- `tecnicos`
- `ocorrencias`
- `agendamentos`
- `comandas`
- `catracas`
- `anexos`
- `notificacoes_lidas`
- `fcm_tokens`
- `relatorios`
- `auditoria`
- `logs`

Os documentos migrados recebem `legacyTable` e `migratedAt`, preservando o vinculo historico com o SQLite.

## API v1

Base:

```text
/api/v1
```

Endpoints principais:

```text
POST /auth/login
POST /auth/recover
GET  /auth/session
POST /auth/logout
GET  /health
GET  /dashboard
GET  /sync/events

GET    /clientes
POST   /clientes
GET    /clientes/:id
PUT    /clientes/:id
DELETE /clientes/:id

GET    /ocorrencias
POST   /ocorrencias
GET    /ocorrencias/:id
PUT    /ocorrencias/:id
DELETE /ocorrencias/:id

GET    /agendamentos
POST   /agendamentos
GET    /agendamentos/:id
PUT    /agendamentos/:id
DELETE /agendamentos/:id

GET    /comandas
POST   /comandas
GET    /comandas/:id
PUT    /comandas/:id
DELETE /comandas/:id

GET    /catracas
POST   /catracas
GET    /catracas/:id
PUT    /catracas/:id
DELETE /catracas/:id
POST   /catracas/:id/anexos

GET    /tecnicos
POST   /tecnicos
GET    /tecnicos/:id
PUT    /tecnicos/:id
DELETE /tecnicos/:id

POST /fcm/tokens

GET  /relatorios/diario
GET  /relatorios/mensal
GET  /notificacoes
POST /notificacoes/push
```

Os agendamentos aceitam o campo `notes` para observacoes operacionais, como pecas a levar, pendencias ou orientacoes para a proxima visita.

## Autenticacao e permissoes

Perfis previstos:

- `admin`
- `tecnico`
- `operacional`
- `leitura`

Em producao, use `API_V1_REQUIRE_AUTH=true`.

Fluxo Web/API com autenticacao:

1. Web envia `POST /api/v1/auth/login`.
2. API valida no Firebase Authentication via REST Identity Toolkit.
3. API retorna token.
4. Cliente envia `Authorization: Bearer <token>`.
5. API valida token com Firebase Admin.
6. API aplica controle de perfil.

Fluxo Android operacional:

1. Usuario informa o proprio nome ao abrir o app.
2. App envia `X-Corretivas-Mobile: true` e `X-Operator-Name` em cada requisicao.
3. API registra esse nome em `audit_logs.user_name`.
4. Para desativar esse modo, defina `API_V1_ALLOW_MOBILE_NAME_AUTH=false`.

Fallback local:

Quando Firebase nao esta configurado, `ADMIN_EMAIL` e `ADMIN_PASSWORD` permitem login local para desenvolvimento.

## Sincronizacao em tempo real

O endpoint `/api/v1/sync/events` usa Server-Sent Events.

Quando qualquer registro e criado, alterado, excluido ou recebe foto, a API emite um evento `change`.

O Android escuta esse stream e atualiza as telas. O web atual continua usando `/api/events`; ambos sao alimentados pelo mesmo `broadcast` interno.

## Push de agendamentos

Ao cadastrar uma visita tecnica pelo web ou pelo Android, a API monta a notificacao:

```text
Nova manutencao agendada!
-CLIENTE, dd/mm/aaaa-
```

O evento e enviado pelo mesmo `broadcast` interno. Celulares com o app aberto exibem o pop-up local imediatamente e ignoram o aviso quando o proprio aparelho criou o agendamento, usando o header `X-Device-Id`.

O Android tambem registra o token FCM em:

```text
POST /api/v1/fcm/tokens
```

Quando Firebase Admin estiver configurado no servidor, a API envia o push para os tokens salvos. Para funcionar com o app fechado, configure:

- `mobile/corretivas_app/android/app/google-services.json` no projeto Android.
- `FIREBASE_PROJECT_ID` no Railway.
- `FIREBASE_SERVICE_ACCOUNT_JSON` ou `GOOGLE_APPLICATION_CREDENTIALS` no Railway.

Sem essas credenciais, o sistema segue funcionando por tempo real enquanto o app estiver aberto, e registra log informando que o envio FCM foi ignorado.

## Funcionamento offline Android

O app Flutter possui fila local em `SharedPreferences`.

Quando uma operacao falha por conexao:

1. Ela entra na fila local.
2. O usuario continua trabalhando.
3. A fila guarda o nome do usuario que executou a operacao.
4. Ao tocar em sincronizar, ou quando a conectividade for evoluida, a fila e reenviada para a API mantendo a autoria original.

Expansao recomendada: trocar a fila simples por SQLite local ou Drift para cache mais completo.

## Upload de fotos

Fluxo:

1. Android tira foto ou seleciona imagem.
2. App envia Base64 para `POST /api/v1/catracas/:id/anexos`.
3. API redimensiona para ate 1600px e compacta JPEG.
4. Em `DATA_BACKEND=firebase`, API salva no Firebase Storage.
5. Em fallback SQLite, API salva em `data/uploads`.
6. API registra auditoria e emite evento em tempo real.

## Backup

Criar backup local completo:

```powershell
npm run firebase:backup
```

O backup cria:

- snapshot JSON das tabelas.
- copia do `corretivas.sqlite`.
- copia da pasta `data/uploads`, quando existir.

Saida:

```text
backups/corretivas-AAAA-MM-DD...
```

## Migracao SQL -> Firebase

Simulacao:

```powershell
npm run firebase:migrate:dry
```

Aplicar no Firebase:

```powershell
npm run firebase:migrate
```

O processo:

1. Le SQLite atual.
2. Cria backup antes de qualquer escrita.
3. Conta registros por tabela.
4. Grava documentos no Firestore.
5. Envia anexos para Storage, se bucket configurado.
6. Cria documento em `relatorios` com resumo da migracao.

## Validacao de integridade

Validar apenas SQLite:

```powershell
npm run firebase:validate
```

Comparar SQLite com Firebase:

```powershell
npm run firebase:validate:remote
```

O comando falha com exit code `1` se o Firebase tiver menos registros que o SQLite.

## Restauracao

Restaurar backup:

```powershell
npm run firebase:restore -- backups\corretivas-AAAA-MM-DD...
```

Isso recoloca `data/corretivas.sqlite` e `data/uploads`.

## Android

Projeto:

```text
mobile/corretivas_app
```

Instalar Flutter e Android SDK, depois:

```powershell
cd mobile\corretivas_app
flutter pub get
flutter build apk --debug --dart-define=API_BASE_URL=https://corretivas.up.railway.app
```

APK esperado:

```text
mobile\corretivas_app\build\app\outputs\flutter-apk\app-debug.apk
```

No emulador Android, use:

```text
http://10.0.2.2:3001
```

Em celular fisico na rede:

```text
http://IP-DO-SERVIDOR:3001
```

O build atual usa como padrao:

```text
https://corretivas.up.railway.app
```

Para uma URL publica, gere novo APK com:

```powershell
flutter build apk --debug --dart-define=API_BASE_URL=https://SEU-DOMINIO
```

Fora da empresa, o app so funciona se a API estiver acessivel pelo celular. Caminhos recomendados:

- Hospedar Web/API em servidor com HTTPS e dominio publico.
- Usar VPN corporativa para acessar o servidor interno.
- Configurar a URL publica no primeiro acesso do aplicativo.

Nao e recomendado expor a porta local do computador diretamente na internet sem HTTPS, firewall e controle operacional.

## Testes executados localmente

- Sintaxe backend: `npm run lint`.
- Build web: `npm run build`.
- Migracao dry-run: `npm run firebase:migrate:dry`.
- Validacao SQLite: `npm run firebase:validate`.
- API v1 runtime em fallback SQLite: `/api/v1/health`, `/api/v1/ocorrencias`, `/api/v1/clientes`.

## Bloqueios externos atuais

- Firebase nao possui credenciais configuradas neste workspace.
- Publicacao externa da API ainda depende de servidor, dominio/HTTPS ou VPN.
- Firebase nao possui credenciais configuradas neste workspace.
- APK real e migracao remota dependem desses dois itens.

## Expansoes futuras previstas

- iOS usando a mesma base Flutter.
- Portal do cliente consumindo `/api/v1`.
- WhatsApp para alertas e status.
- Integracao ERP.
- Integracao com sistemas de controle de acesso.
- Monitoramento externo de logs.
- Cache offline mais robusto com banco local no Android.
