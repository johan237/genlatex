# GenLaTeX

**GenLaTeX** (GenLaTeX) is a powerful AI-native-first LaTeX editor capable of doing anything doable with LaTeX. Enhanced AI features and chat let you edit with natural language; agents handle generation, research, citations, and more. Inspired by Overleaf.

## Features

- **Authentication**: Email/password and Google login with Better Auth and PostgreSQL
- **Project Management**: Create, list, and delete LaTeX projects
- **Monaco Editor**: Full-featured LaTeX editor with syntax highlighting
- **Live Compilation**: Compile LaTeX to PDF using Tectonic
- **PDF Preview**: Live PDF preview with PDF.js
- **Auto-save**: Automatic saving to localStorage and server
- **Modern UI**: Clean, minimal interface with Tailwind CSS

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS
- **Backend**: Next.js API routes, PostgreSQL
- **Authentication**: Better Auth (email/password + Google OAuth)
- **Editor**: Monaco Editor
- **PDF**: PDF.js for preview, Tectonic for compilation
- **Styling**: Tailwind CSS with blue-600 theme

## Prerequisites

- Node.js 18+
- PostgreSQL database
- Tectonic LaTeX compiler

## Installation

1. **Clone and install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your database URL and secrets
   ```

3. **Install Tectonic**:
   ```bash
   # macOS
   brew install tectonic-typesetting/tap/tectonic
   
   # Linux
   curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net |sh
   
   # Windows
   # Download from https://tectonic-typesetting.github.io/en-US/
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```

5. **Open your browser**:
   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1. **Register/Login**: Create an account or sign in
2. **Create Project**: Add a new LaTeX project from the dashboard
3. **Edit**: Use the Monaco editor to write LaTeX
4. **Compile**: Click "Compile" to generate PDF
5. **Preview**: View the compiled PDF in the preview panel

## Project Structure

```
genlatex/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   ├── dashboard/         # Dashboard page
│   ├── editor/            # Editor pages
│   ├── login/             # Auth pages
│   └── register/
├── components/            # React components
├── lib/                   # Utilities
│   ├── db.js             # Database connection
│   ├── auth.js           # Better Auth config
│   ├── files.js          # File operations
│   └── compile.js        # LaTeX compilation
└── data/                 # Project files (created at runtime)
```

## API Endpoints

- `POST /api/register` - User registration
- `GET /api/projects` - List user projects
- `POST /api/projects` - Create project
- `DELETE /api/projects/[id]` - Delete project
- `GET /api/files/[projectId]` - Get project file
- `POST /api/files/[projectId]` - Save project file
- `POST /api/compile/[projectId]` - Compile LaTeX
- `GET /api/pdf/[projectId]` - Stream compiled PDF

## License

Proprietary - All rights reserved.

## Development

This is a minimal MVP implementation. Future enhancements could include:

- Real-time collaboration with WebSockets
- File tree navigation
- Multiple LaTeX files per project
- Version control integration
- Advanced PDF viewer features
- User management and permissions
