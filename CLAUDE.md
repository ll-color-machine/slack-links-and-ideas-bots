# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Development Server:**
- `npm run dev` - Start the application with nodemon for automatic reloading
- `NODE_ENV=dev nodemon` - Alternative way to start development server

**Production:**
- `node app.js` - Run the production server
- Heroku deployment uses `worker: node app.js` (see Procfile)

## Architecture Overview

This is a Slack bot application built with Slack Bolt framework that provides multiple specialized bots and handlers for processing messages, events, and files in Slack workspaces.

### Core Components

**Entry Point (`app.js`):**
- Initializes Slack Bolt app with socket mode
- Sets up message handlers and event listeners
- Manages runtime configuration and Airtable synchronization
- Creates necessary directories (`_temp`, `_output`, `_cache`) on startup

**Event Handling System:**
- `src/handlers/message-handler.js` - Processes all incoming Slack messages, filters bot messages and subthreads
- `src/handlers/event-handler.js` - Handles file sharing events (especially PDFs) and emoji reactions
- Event-driven architecture for PDF processing triggered by `:books:` reactions

**Bot System (`src/bots/`):**
- Modular bot architecture with specialized bots in subdirectories
- `pdf-bot/` - Complete PDF processing pipeline with OpenAI analysis and Airtable storage
- `archive/` - Contains legacy bots (bkc-bots, rainbow-tests, ts280, poster-maker)

**Configuration System (`src/config/`):**
- Runtime configuration cached from Airtable with 5-minute refresh intervals
- Manages users, emojis, prompts, and flows from Airtable tables
- Automatic Slack-to-Airtable user synchronization

### PDF Processing Workflow

The PDF bot implements a complete document processing pipeline:

1. **Detection**: Automatically processes PDFs when shared or when `:books:` reaction is added
2. **Download**: Downloads PDF files from Slack using bot tokens
3. **Analysis**: Uses OpenAI to extract metadata, summaries, and categorization
4. **Storage**: Saves records to Airtable with normalized topics and study types
5. **Response**: Posts formatted results back to Slack as threaded responses

Key files:
- `src/bots/pdf-bot/index.js` - Main processing orchestration
- `src/bots/pdf-bot/download.js` - Handles Slack file downloads
- `src/bots/pdf-bot/analyze.js` - OpenAI integration for PDF analysis
- `src/bots/pdf-bot/storage.js` - Airtable integration for record storage
- `src/bots/pdf-bot/blocks.js` - Slack Block Kit formatting

### Environment Configuration

**Required Environment Variables:**
- `SLACK_BOT_TOKEN` - Bot user OAuth token
- `SLACK_SIGNING_SECRET` - Slack app signing secret
- `SLACK_APP_TOKEN` - Socket mode app token
- `SLACK_USER_TOKEN` - User OAuth token for file access
- `SLACK_LOGGING_CHANNEL` - Channel for bot startup notifications
- `OPENAI_API_KEY` - OpenAI API access for PDF analysis
- `AIRTABLE_API_TOKEN` - Airtable API access
- `AIRTABLE_BASE_ID` - Base ID for configuration storage

**Configuration Tables in Airtable:**
- `AIRTABLE_TABLE_EMOJIS` (default: "Emojis") - Emoji reaction configurations
- `AIRTABLE_TABLE_PROMPTS` (default: "Prompts") - AI prompt templates
- `AIRTABLE_TABLE_FLOWS` (default: "Flows") - Multi-step workflows
- `AIRTABLE_TABLE_USERS` (default: "Users") - Workspace user records

### File Organization

- `/src/handlers/` - Event and message processing logic
- `/src/bots/` - Specialized bot implementations
- `/src/config/` - Runtime configuration management
- `/src/utils/` - Utility functions and logging
- `/src/styles/` - UI and formatting components
- `/_cache/` - Runtime configuration cache (git-ignored)
- `/_temp/` - Temporary file storage (git-ignored)
- `/_output/` - Processing output storage (git-ignored)
- `/logs/` - Application logs (git-ignored)

### Development Notes

- Uses CommonJS module system (`"type": "commonjs"` in package.json)
- Nodemon configured to ignore cache, temp, output, and log directories
- Console logging enhanced with custom file logger (`console-file-logger.cjs`)
- No test framework currently configured
- Socket mode enabled for development without webhook setup requirements