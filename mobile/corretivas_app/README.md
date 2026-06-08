# Corretivas Android

Aplicativo Flutter integrado exclusivamente a API centralizada do Sistema de Corretivas.

## Rodar

Instale Flutter e Android SDK.

```powershell
flutter pub get
flutter run --dart-define=API_BASE_URL=http://192.168.15.8:3001
```

## Gerar APK de teste

```powershell
flutter build apk --debug --dart-define=API_BASE_URL=http://IP-DO-SERVIDOR:3001
```

## Acesso

O aplicativo nao solicita login e senha. Na abertura, o usuario informa apenas o proprio nome.

Esse nome e enviado para a API em todas as operacoes e fica registrado na auditoria de cadastros, edicoes, exclusoes e uploads.

## Uso fora da empresa

O APK atual usa como URL padrao:

```text
http://192.168.15.8:3001
```

O aplicativo funciona em qualquer lugar desde que consiga acessar a URL da API configurada.

Para uso em campo pelos tecnicos, a API nao pode ficar exposta apenas como `localhost` ou IP da rede interna. Use uma destas opcoes:

- Hospedar o sistema/API em um servidor ou VPS com HTTPS.
- Publicar a API em um dominio da empresa, por exemplo `https://corretivas.suaempresa.com.br`.
- Usar VPN para que o celular acesse a rede interna com seguranca.
- Evitar redirecionamento simples de porta do roteador sem HTTPS e controle de acesso.

No emulador Android local tambem e possivel usar `http://10.0.2.2:3001`. Em celular na mesma rede use `http://IP-DO-SERVIDOR:3001`. Fora da rede, use a URL publica ou VPN.

## Detalhes dos registros

As listas de agendamentos, ocorrencias, comandas, catracas, clientes e tecnicos sao clicaveis.

Ao tocar em um item, o app abre a tela de detalhes com todos os campos do registro e acoes de editar, excluir, atualizar e enviar foto quando aplicavel.

O dashboard mobile consome `/api/v1/dashboard` e exibe os mesmos indicadores principais do dashboard web.

## Observacoes

- O app nao acessa Firebase diretamente.
- Consultas, cadastros, edicoes, exclusoes, fotos e eventos passam por `/api/v1`.
- Operacoes feitas offline entram em fila local e podem ser reenviadas pelo botao de sincronizacao.
