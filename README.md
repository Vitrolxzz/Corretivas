# Corretivas

Sistema web para acompanhamento operacional de corretivas, agendamentos de visitas tecnicas, cadastro de comandas, catracas para montagem e fechamento anual de periodos.

Esta versao nao usa Docker. O banco e um arquivo SQL local em SQLite, criado automaticamente em:

```text
data\corretivas.sqlite
```

## Instalar

No computador que ficara como servidor, execute:

```text
Instalar.bat
```

Esse atalho instala as dependencias, cria o banco local e gera a versao de producao da interface.

## Iniciar

Execute:

```text
Iniciar Corretivas.bat
```

No proprio computador:

```text
http://localhost:3001
```

Nos outros computadores da rede:

```text
http://IP-DO-SERVIDOR:3001
```

Se o Windows bloquear o acesso pela rede, libere a porta `3001` no Firewall do Windows.

## Importar a planilha base

Com o sistema instalado, execute:

```text
Importar Excel.bat
```

Por padrao, o importador usa:

```text
C:\Users\Vittor\OneDrive\ASSIST TECNICA\CORRETIVAS 2026 ATUAL.xlsx
```

Tambem e possivel informar outro arquivo manualmente:

```powershell
node scripts/importExcel.js "C:\caminho\arquivo.xlsx" 2026
```

## Desenvolvimento

```powershell
npm run dev
```

Interface de desenvolvimento:

```text
http://localhost:5173
```

API:

```text
http://localhost:3001
```

## Periodos anuais

A tela `Periodos` encerra o ano ativo e cria o proximo. Os registros do ano encerrado ficam bloqueados para edicao, mas continuam disponiveis para consulta e exportacao CSV.

## Areas do sistema

- `Dashboard`: tela inicial com indicadores operacionais, graficos, notificacoes, gestao de tecnicos, historicos de clientes/tecnicos e relatorio mensal.
- `Agendamentos`: cadastro, edicao, exclusao, filtros, paginacao, modo lista e calendario mensal/semanal/diario com arrastar e soltar.
- `Ocorrencias`: fluxo existente de corretivas, casos monitorados, dashboard de atendimentos por cliente e relatorio diario.
- `Cadastro de Comandas`: cadastro e gerenciamento de comandas por periodo.
- `Catracas para Montagem`: cadastro de catracas, Kanban por status, controle visual de prazos e anexos de fotos.

## Pesquisa global

A barra no topo pesquisa clientes, ocorrencias, comandas, agendamentos e catracas. Os resultados aparecem agrupados por categoria e abrem diretamente o registro ou o historico completo do cliente.

## Anexos de catracas

As fotos anexadas ficam salvas em:

```text
data\uploads\catracas
```

A API de anexos recebe imagens em Base64, o que ja deixa a estrutura preparada para integracao futura com aplicativo movel. Antes de salvar, as imagens sao redimensionadas para ate 1600px e compactadas em JPEG otimizado.

## Notificacoes

A central de notificacoes mantem o contador de itens nao lidos. Ao abrir uma notificacao ou marcar todas como lidas, essa leitura fica persistida no banco local.

Quando uma visita tecnica e cadastrada, a API envia o evento de notificacao `Nova manutencao agendada!` para os celulares conectados. O corpo mostra apenas cliente e data no formato `-CLIENTE, dd/mm/aaaa-`.

Com o app aberto, o aviso aparece pelo canal em tempo real `/api/v1/sync/events`. Para receber push com o app fechado, configure Firebase Cloud Messaging no Android e as credenciais Firebase Admin no servidor Railway.

## Performance

O calendario visual e carregado sob demanda. A primeira tela abre sem carregar o pacote do calendario, que so e baixado quando o modo `Calendario` de agendamentos e aberto.

## API v1, Firebase e Android

Foi adicionada uma API versionada em:

```text
/api/v1
```

Ela prepara o sistema para o ecossistema Web + Android + Firebase, mantendo o web atual funcionando.

Documentacao completa:

```text
docs\ecossistema-android-firebase.md
```

Projeto Android Flutter:

```text
mobile\corretivas_app
```

Comandos de backup/migracao:

```powershell
npm run firebase:backup
npm run firebase:migrate:dry
npm run firebase:migrate
npm run firebase:validate
npm run firebase:validate:remote
npm run firebase:restore -- backups\NOME-DO-BACKUP
```

## Exportacoes

As telas principais possuem exportacao para PDF, Excel e impressao quando aplicavel. As exportacoes tambem estao disponiveis por API em `/api/export`.

## Backup

Para fazer backup, copie a pasta `data`. O arquivo principal e `data\corretivas.sqlite`; quando o sistema estiver aberto tambem podem existir arquivos auxiliares `-wal` e `-shm`, alem da pasta `uploads` com fotos de catracas, entao copie a pasta inteira.
