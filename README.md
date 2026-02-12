# Live Drop

Sistema de monitoramento e processamento de rolls (sorteios) do CSGO.net com suporte a múltiplos streamers. O sistema faz scraping automatizado, armazena dados e transmite resultados em tempo real via WebSocket.

## 📋 Índice

- [Características](#-características)
- [Pré-requisitos](#-pré-requisitos)
- [Instalação](#-instalação)
- [Configuração](#-configuração)
- [Uso](#-uso)
- [API](#-api)
- [Páginas Web](#-páginas-web)
- [Scripts Disponíveis](#-scripts-disponíveis)
- [Estrutura do Projeto](#-estrutura-do-projeto)
- [Variáveis de Ambiente](#-variáveis-de-ambiente)

## ✨ Características

- ✅ Suporte a múltiplos streamers
- ✅ Processamento assíncrono de rolls com fila
- ✅ Scraping automatizado com Puppeteer
- ✅ WebSocket para atualizações em tempo real
- ✅ Retry automático com limite de tentativas
- ✅ Interface web para visualização de drops
- ✅ API REST completa
- ✅ Processamento concorrente seguro

## 🔧 Pré-requisitos

- **Node.js** 18+ (recomendado 20 LTS)
- **MySQL** 8+ (requer `SKIP LOCKED` para processamento concorrente)
- **Git** e terminal/bash
- (Opcional) **MySQL CLI** para executar migrations manualmente

## 🚀 Instalação

### 1. Clone o repositório

```bash
git clone <repository-url>
cd live-drop
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure o banco de dados

Crie o banco de dados MySQL:

```sql
CREATE DATABASE live_drop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 4. Configure as variáveis de ambiente

Copie o arquivo `.env.example` para `.env` e configure as variáveis:

```bash
cp .env.example .env
```

Edite o arquivo `.env` com suas configurações (veja [Variáveis de Ambiente](#-variáveis-de-ambiente)).

### 5. Execute as migrations

```bash
npm run migrate
```

Isso executará todas as migrations:
- `001_init.sql` - Cria as tabelas iniciais
- `002_add_streamer.sql` - Adiciona suporte a múltiplos streamers

**Alternativa manual:**

```bash
mysql -h 127.0.0.1 -u live_drop -p live_drop < migrations/001_init.sql
mysql -h 127.0.0.1 -u live_drop -p live_drop < migrations/002_add_streamer.sql
```

### 6. Inicie o servidor

**Desenvolvimento:**
```bash
npm run dev
```

**Produção:**
```bash
npm run build
npm start
```

O servidor estará disponível em `http://localhost:3000` (ou a porta configurada no `.env`).

## ⚙️ Configuração

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
# Servidor
NODE_ENV=development
PORT=3000

# MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=live_drop
MYSQL_USER=live_drop
MYSQL_PASSWORD=sua_senha_aqui

# Jobs
JOBS_DEFAULT_BATCH=5
JOBS_MAX_TRIES=3

# Puppeteer (opcional)
PPTR_MAX_PAGES=5
PPTR_HEADFUL=false
PPTR_SLOWMO=0
PPTR_DEVTOOLS=false
PPTR_DEBUG_PORT=0
PPTR_EXECUTABLE_PATH=
PPTR_BLOCK_DETECTION=true
SERVER=hml  # se "hml", headless=false
```

### Carregar variáveis manualmente (bash)

```bash
set -a               # exporta variáveis automaticamente
source .env          # carrega o arquivo .env
set +a
```

## 📖 Uso

### Enfileirar um Roll

```bash
curl -X POST http://localhost:3000/api/rolls \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "streamer": "streamer1",
    "rollId": "roll456",
    "type": "upgrade"
  }'
```

### Acessar Viewer

```
http://localhost:3000/live-drop?streamer=streamer1
```

### Acessar Página do Streamer

```
http://localhost:3000/live-drop-streammer?streamer=streamer1
```

## 🔌 API

### POST /api/rolls

Enfileira um roll para processamento.

**Request:**
```json
{
  "userId": "string",
  "streamer": "string",
  "rollId": "string",
  "type": "upgrade" | "case"
}
```

**Response:** `202 Accepted`
```json
{
  "ok": true
}
```

### GET /api/rolls

Lista rolls da fila com filtros.

**Query Parameters:**
- `streamer` (opcional): Filtrar por streamer
- `state` (opcional): `queued` | `processing` | `failed`
- `userId` (opcional): Filtrar por usuário
- `type` (opcional): `upgrade` | `case`
- `limit` (opcional): Número de resultados (1-1000, padrão: 100)

**Exemplo:**
```bash
curl "http://localhost:3000/api/rolls?streamer=streamer1&state=queued"
```

### GET /api/fetched-rolls

Lista rolls já processados.

**Query Parameters:**
- `streamer` (opcional): Filtrar por streamer
- `userId` (opcional): Filtrar por usuário
- `type` (opcional): `upgrade` | `case`
- `limit` (opcional): Número de resultados (1-1000, padrão: 100)

**Exemplo:**
```bash
curl "http://localhost:3000/api/fetched-rolls?streamer=streamer1&limit=20"
```

### POST /api/jobs/consume

Dispara processamento manual de jobs.

**Request:**
```json
{
  "batch": 5  // opcional, 1-50
}
```

**Response:**
```json
{
  "claimed": 5,
  "done": 4,
  "requeued": 1
}
```

### GET /healthz

Health check do servidor.

**Response:**
```json
{
  "ok": true
}
```

## 🌐 Páginas Web

### Viewer (`/live-drop`)

Página para visualizar drops processados de um streamer específico.

**URL:**
```
http://localhost:3000/live-drop?streamer=NOME_DO_STREAMER
```

**Características:**
- Carrega os últimos 20 drops processados
- Atualizações em tempo real via WebSocket
- Filtra automaticamente por streamer

### Streamer (`/live-drop-streammer`)

Página otimizada para o streamer visualizar seus drops durante a transmissão.

**URL:**
```
http://localhost:3000/live-drop-streammer?streamer=NOME_DO_STREAMER
```

**Características:**
- Interface otimizada para OBS/streaming
- Atualizações em tempo real
- Filtra apenas drops do streamer especificado

## 📜 Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `npm run dev` | Inicia servidor em modo desenvolvimento com hot-reload |
| `npm run build` | Compila TypeScript para JavaScript |
| `npm start` | Inicia servidor em modo produção |
| `npm run migrate` | Executa todas as migrations |
| `npm run migrate:init` | Executa apenas a migration inicial |
| `npm run migrate:streamer` | Executa apenas a migration de streamer |

## 📁 Estrutura do Projeto

```
live-drop/
├── migrations/          # SQL migrations
│   ├── 001_init.sql
│   └── 002_add_streamer.sql
├── public/             # Arquivos estáticos e HTML
│   ├── live-drop.html
│   └── live-drop-streammer.html
├── scripts/            # Scripts utilitários
│   └── migrate.js
├── src/                # Código fonte TypeScript
│   ├── config/         # Configurações
│   ├── db/             # Conexão com banco
│   ├── http/           # Servidor HTTP e rotas
│   ├── jobs/            # Job runner
│   ├── managers/        # Lógica de negócio
│   ├── repositories/    # Acesso a dados
│   ├── services/        # Serviços (Puppeteer, WebSocket)
│   └── utils/           # Utilitários
├── dist/               # Código compilado (gerado)
├── .env                # Variáveis de ambiente
├── package.json
└── tsconfig.json
```

## 🔄 Fluxo de Processamento

1. **Cliente enfileira roll** via `POST /api/rolls`
2. **Sistema adiciona à fila** na tabela `rolls`
3. **Job runner processa** automaticamente a cada 30 segundos
4. **Puppeteer faz scraping** do site CSGO.net
5. **Dados são armazenados** na tabela `fetched_rolls`
6. **WebSocket notifica** clientes conectados em tempo real

## 🗄️ Banco de Dados

### Tabela: `rolls`

Fila de processamento de rolls pendentes.

- `id` - Chave primária
- `user_id` - ID do usuário
- `streamer` - Nome do streamer
- `roll` - ID do roll
- `type` - Tipo: `upgrade` ou `case`
- `state` - Estado: `queued`, `processing`, `failed`
- `tries` - Número de tentativas
- `created_at` - Data de criação
- `updated_at` - Última atualização

### Tabela: `fetched_rolls`

Dados coletados dos rolls processados.

- `id` - Chave primária
- `user_id` - ID do usuário
- `streamer` - Nome do streamer
- `roll` - ID do roll
- `type` - Tipo: `upgrade` ou `case`
- `data` - Dados coletados (JSON)
- `created_at` - Data de criação
- `processed_at` - Data de processamento

## 🔐 Segurança

- CORS configurado para domínios permitidos
- Validação de entrada com Zod
- Processamento concorrente seguro com `FOR UPDATE SKIP LOCKED`
- Retry automático com limite de tentativas

## 🐛 Troubleshooting

### Erro ao executar migration

Certifique-se de que:
- As variáveis de ambiente estão configuradas corretamente
- O banco de dados existe
- O usuário MySQL tem permissões adequadas

### Puppeteer não funciona

- Verifique se as dependências do sistema estão instaladas
- Configure `PPTR_EXECUTABLE_PATH` se necessário
- Para debug, use `PPTR_HEADFUL=true` e `PPTR_DEVTOOLS=true`

### WebSocket não conecta

- Verifique se o servidor está rodando
- Confirme que a porta está correta
- Verifique logs do servidor para erros

## 📝 Licença

Este projeto é privado.

## 👥 Contribuindo

Este é um projeto privado. Para questões ou sugestões, entre em contato com a equipe de desenvolvimento.

