#!/usr/bin/env node

// SPDX-License-Identifier: MIT

import { compileLaTeX } from './lib/compile.js';
import { initializeProject, validateProject, cleanProject, listTemplates } from './lib/project-manager.js';
import { checkBiberInstallation, createBiberInstallationGuide } from './lib/install-biber.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📚 GenLaTeX LaTeX Compilation Test Utility');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  switch (command) {
    case 'compile':
      await testCompile();
      break;

    case 'init':
      await initProject();
      break;

    case 'validate':
      await validateProjectCmd();
      break;

    case 'clean':
      await cleanProjectCmd();
      break;

    case 'check-biber':
      await checkBiber();
      break;

    case 'templates':
      listTemplates();
      break;

    case 'help':
    default:
      showHelp();
      break;
  }
}

function showHelp() {
  console.log('Usage: node test-compile.js <command> [options]\n');
  console.log('Commands:');
  console.log('  compile [project-dir]      - Compile a LaTeX project');
  console.log('  init [type] [dir]          - Initialize a new project (types: article, report, thesis, presentation)');
  console.log('  validate [project-dir]     - Validate project structure');
  console.log('  clean [project-dir]        - Clean build artifacts');
  console.log('  check-biber                - Check Biber installation');
  console.log('  templates                  - List available project templates');
  console.log('  help                       - Show this help\n');
  console.log('Examples:');
  console.log('  node test-compile.js compile ./data/projects/my-project');
  console.log('  node test-compile.js init article ./my-new-project');
  console.log('  node test-compile.js check-biber');
  console.log('  node test-compile.js clean ./data/projects/my-project\n');
}

async function testCompile() {
  const projectPath = args[1] || path.join(__dirname, 'data', 'projects', 'test-project');
  const texFile = args[2] || 'main.tex';

  console.log(`📁 Project: ${projectPath}`);
  console.log(`📝 File: ${texFile}\n`);

  try {
    console.log('🚀 Starting compilation...\n');
    const result = await compileLaTeX(projectPath, texFile);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 COMPILATION RESULT');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (result.code === 0) {
      console.log('✅ Compilation SUCCESSFUL\n');
      if (result.pdfPath) {
        console.log(`📄 PDF Generated: ${result.pdfPath}`);
      }
    } else {
      console.log('❌ Compilation FAILED\n');
      console.log('Error Details:');
      console.log(result.log);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 FULL COMPILATION LOG');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(result.log);

    process.exit(result.code);
  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

async function initProject() {
  const templateType = args[1] || 'article';
  const projectDir = args[2] || path.join(__dirname, 'test-project');

  console.log(`📋 Template: ${templateType}`);
  console.log(`📁 Directory: ${projectDir}\n`);

  try {
    const result = await initializeProject(projectDir, templateType);

    if (result.success) {
      console.log('\n✅ Project initialized successfully!\n');
      console.log('Next steps:');
      console.log(`  1. cd ${projectDir}`);
      console.log('  2. Edit main.tex with your content');
      console.log('  3. Add references to references.bib');
      console.log(`  4. node test-compile.js compile ${projectDir}\n`);
    }
  } catch (error) {
    console.error('❌ Error initializing project:', error.message);
    process.exit(1);
  }
}

async function validateProjectCmd() {
  const projectPath = args[1] || path.join(__dirname, 'data', 'projects', 'test-project');

  console.log(`📁 Validating: ${projectPath}\n`);

  try {
    const validation = await validateProject(projectPath);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 VALIDATION RESULTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (validation.valid) {
      console.log('✅ Project structure is valid\n');
    } else {
      console.log('❌ Project structure has issues\n');
    }

    console.log(`main.tex: ${validation.mainTexExists ? '✅ Found' : '❌ Missing'}`);
    console.log(`Bibliography: ${validation.bibliographyExists ? '✅ Found' : '⚠️  Not found'}\n`);

    if (validation.errors.length > 0) {
      console.log('Errors:');
      validation.errors.forEach(err => console.log(`  ❌ ${err}`));
      console.log();
    }

    if (validation.warnings.length > 0) {
      console.log('Warnings:');
      validation.warnings.forEach(warn => console.log(`  ⚠️  ${warn}`));
      console.log();
    }

    process.exit(validation.valid ? 0 : 1);
  } catch (error) {
    console.error('❌ Error validating project:', error.message);
    process.exit(1);
  }
}

async function cleanProjectCmd() {
  const projectPath = args[1] || path.join(__dirname, 'data', 'projects', 'test-project');

  console.log(`📁 Cleaning: ${projectPath}\n`);

  try {
    const cleaned = await cleanProject(projectPath);
    console.log(`\n✅ Done! Cleaned ${cleaned} file(s)\n`);
  } catch (error) {
    console.error('❌ Error cleaning project:', error.message);
    process.exit(1);
  }
}

async function checkBiber() {
  console.log('🔍 Checking Biber installation...\n');

  try {
    const result = await checkBiberInstallation();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 BIBER STATUS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (result.found) {
      console.log('✅ Biber is installed\n');
      console.log(`Location: ${result.path}`);
      if (result.version) {
        console.log(`\nVersion Info:\n${result.version}`);
      }
    } else {
      console.log('❌ Biber is NOT installed\n');
      console.log('Biber is required for biblatex bibliography processing.');
      console.log('Without it, bibliographies will not compile correctly.\n');

      // Create installation guide
      const guidePath = path.join(__dirname, 'BIBER_INSTALLATION.md');
      await createBiberInstallationGuide(guidePath);
      console.log(`\n📖 See ${guidePath} for installation instructions\n`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(result.found ? 0 : 1);
  } catch (error) {
    console.error('❌ Error checking Biber:', error.message);
    process.exit(1);
  }
}

// Run main
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
