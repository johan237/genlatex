# Environment Variables Setup

This document explains how to configure environment variables for the GenLaTeX LaTeX Editor with DeepSeek-R1 AI integration.

## Required Environment Variables

### Database Configuration
```bash
DATABASE_URL=postgresql://username:password@localhost:5432/genlatex
BETTER_AUTH_SECRET=your_32_char_minimum_secret_here
BETTER_AUTH_URL=http://localhost:3000
PROJECT_PATH=./data/projects
```

### OpenRouter API Configuration
```bash
# Get your API key from https://openrouter.ai/
OPENROUTER_API_KEY=sk-or-v1-your-actual-api-key-here
```

## Optional AI Configuration

### AI Behavior Settings
```bash
# Creativity level (0.0-1.0, default: 0.7)
AI_TEMPERATURE=0.7

# Maximum response length (default: 2000)
AI_MAX_TOKENS=2000

# Request timeout in milliseconds (default: 30000)
AI_TIMEOUT=30000
```

### Rate Limiting Settings
```bash
# Delay between requests in milliseconds (default: 1000)
AI_REQUEST_DELAY=1000

# Maximum retry attempts (default: 3)
AI_MAX_RETRIES=3
```

### GenLaTeX Agent Configuration
```bash
# Base URL for genlatex-agent API (default: http://localhost:8000)
GENLATEX_AGENT_URL=http://localhost:8000

# Request timeout in milliseconds (default: 30000)
GENLATEX_AGENT_TIMEOUT=30000

# Enable/disable genlatex-agent (default: true)
GENLATEX_AGENT_ENABLED=true

# Base URL for the GenLaTeX web app (used by genlatex-agent to persist ingested images)
# Set this in genlatex-agent/.env as well.
GENLATEX_APP_URL=http://localhost:3000
```

## Setup Instructions

### 1. Copy Environment Template
```bash
cp .env.example .env
```

### 2. Edit Environment Variables
Open `.env` file and update the following:

#### Required Variables
- `OPENROUTER_API_KEY`: Get from [OpenRouter](https://openrouter.ai/)
- `DATABASE_URL`: Your PostgreSQL connection string
- `BETTER_AUTH_SECRET`: Generate a secure random string (min 32 chars, e.g. `openssl rand -base64 32`)

#### Optional Variables
- `AI_TEMPERATURE`: Adjust creativity (0.0 = deterministic, 1.0 = creative)
- `AI_MAX_TOKENS`: Control response length
- `AI_TIMEOUT`: Set request timeout
- `AI_REQUEST_DELAY`: Control rate limiting
- `AI_MAX_RETRIES`: Set retry attempts

### 3. Generate BETTER_AUTH_SECRET
```bash
# Using OpenSSL (recommended)
openssl rand -base64 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4. Restart Development Server
```bash
npm run dev
```

## Environment Variable Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | - | OpenRouter API key for DeepSeek-R1 |
| `DATABASE_URL` | Yes | - | PostgreSQL database connection string |
| `BETTER_AUTH_SECRET` | Yes | - | Secret for Better Auth (min 32 chars) |
| `BETTER_AUTH_URL` | Yes | - | Base URL for the app (e.g. http://localhost:3000) |
| `PROJECT_PATH` | Yes | - | Path to store project files |
| `AI_TEMPERATURE` | No | 0.7 | AI creativity level (0.0-1.0) |
| `AI_MAX_TOKENS` | No | 2000 | Maximum response length |
| `AI_TIMEOUT` | No | 30000 | Request timeout (ms) |
| `AI_REQUEST_DELAY` | No | 1000 | Delay between requests (ms) |
| `AI_MAX_RETRIES` | No | 3 | Maximum retry attempts |
| `GENLATEX_AGENT_URL` | No | http://localhost:8000 | GenLaTeX Agent API base URL |
| `GENLATEX_AGENT_TIMEOUT` | No | 30000 | GenLaTeX Agent request timeout (ms) |
| `GENLATEX_AGENT_ENABLED` | No | true | Enable/disable GenLaTeX Agent |

## Security Considerations

### API Key Protection
- Never commit API keys to version control
- Use `.env.local` for local development
- Use environment variables in production
- Rotate API keys regularly

### Database Security
- Use strong passwords
- Enable SSL connections
- Restrict database access
- Regular backups

### Authentication Security
- Use strong BETTER_AUTH_SECRET
- Enable HTTPS in production
- Configure proper CORS settings
- Implement rate limiting

## Troubleshooting

### Common Issues

#### 1. API Key Not Working
```bash
# Check if API key is set
echo $OPENROUTER_API_KEY

# Verify API key format
# Should start with 'sk-or-v1-'
```

#### 2. Database Connection Failed
```bash
# Check database URL format
# Should be: postgresql://user:pass@host:port/database

# Test database connection
psql $DATABASE_URL
```

#### 3. Environment Variables Not Loading
```bash
# Restart development server
npm run dev

# Check .env file location
# Should be in project root directory
```

#### 4. AI Features Not Working
```bash
# Check API key validity
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     https://openrouter.ai/api/v1/models

# Check rate limits
# OpenRouter free tier: 100 requests/day
```

### Debug Mode
Enable debug logging by adding:
```bash
DEBUG=genlatex:*
NODE_ENV=development
```

## Production Deployment

### Environment Variables for Production
```bash
# Production database
DATABASE_URL=postgresql://user:pass@prod-host:5432/genlatex

# Production authentication (Better Auth)
BETTER_AUTH_URL=https://your-domain.com
BETTER_AUTH_SECRET=your-production-secret

# Production AI settings
AI_TEMPERATURE=0.5
AI_MAX_TOKENS=1500
AI_TIMEOUT=20000
AI_REQUEST_DELAY=2000
AI_MAX_RETRIES=5
```

### Security Checklist
- [ ] Use HTTPS in production
- [ ] Set secure BETTER_AUTH_SECRET
- [ ] Configure proper CORS
- [ ] Enable database SSL
- [ ] Implement rate limiting
- [ ] Monitor API usage
- [ ] Regular security updates

## Support

For issues with environment setup:
1. Check this documentation
2. Verify variable names and values
3. Test with minimal configuration
4. Check server logs for errors
5. Contact support if needed

## Related Documentation

- [DeepSeek-R1 Setup Guide](./DEEPSEEK_SETUP.md)
- [Database Configuration](./DATABASE_SETUP.md)
- [Deployment Guide](./DEPLOYMENT.md)

---

**Note (for later):** You may want to standardize agent-related env var naming: the app uses both `GENLATEX_AGENT_URL` (server) and `NEXT_PUBLIC_GENLATEX_AGENT_URL` (client e.g. SSE), and both `GENLATEX_AGENT_API_KEY` and `AGENT_API_TOKEN` for the agent API key. Everything works if set correctly; consider documenting or consolidating these names later.
