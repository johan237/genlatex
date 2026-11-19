// SPDX-License-Identifier: MIT

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import https from 'https';

/**
 * Check if Biber is installed
 */
export async function checkBiberInstallation() {
  const possiblePaths = [
    'biber',
    'biber.exe',
    'C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\biber.exe',
    'C:\\Program Files\\TeX Live\\2024\\bin\\win32\\biber.exe',
    'C:\\texlive\\2024\\bin\\win32\\biber.exe'
  ];

  for (const biberPath of possiblePaths) {
    try {
      const found = await new Promise((resolve) => {
        const proc = spawn(biberPath, ['--version'], { stdio: 'pipe' });
        let output = '';

        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ found: true, path: biberPath, version: output });
          } else {
            resolve({ found: false });
          }
        });

        proc.on('error', () => resolve({ found: false }));

        setTimeout(() => resolve({ found: false }), 3000);
      });

      if (found.found) {
        return found;
      }
    } catch (err) {
      continue;
    }
  }

  return { found: false };
}

/**
 * Get installation instructions based on OS
 */
export function getInstallationInstructions() {
  const platform = process.platform;

  const instructions = {
    win32: {
      title: 'Install Biber on Windows',
      methods: [
        {
          name: 'MiKTeX (Recommended)',
          steps: [
            '1. Download MiKTeX from https://miktex.org/download',
            '2. Run the installer and follow the setup wizard',
            '3. Choose "Install missing packages on-the-fly: Yes"',
            '4. After installation, open MiKTeX Console',
            '5. Go to "Packages" and search for "biber"',
            '6. Install the biber package',
            '7. Restart your terminal/application'
          ],
          downloadUrl: 'https://miktex.org/download'
        },
        {
          name: 'TeX Live',
          steps: [
            '1. Download TeX Live from https://www.tug.org/texlive/windows.html',
            '2. Run install-tl-windows.exe',
            '3. Follow the installation wizard (full installation recommended)',
            '4. Biber is included by default',
            '5. Restart your terminal/application'
          ],
          downloadUrl: 'https://www.tug.org/texlive/acquire-netinstall.html'
        },
        {
          name: 'Standalone Biber',
          steps: [
            '1. Download Biber from https://sourceforge.net/projects/biblatex-biber/',
            '2. Extract the biber.exe file',
            '3. Place it in a directory like C:\\Program Files\\Biber',
            '4. Add that directory to your system PATH',
            '5. Restart your terminal/application'
          ],
          downloadUrl: 'https://sourceforge.net/projects/biblatex-biber/files/'
        }
      ]
    },
    darwin: {
      title: 'Install Biber on macOS',
      methods: [
        {
          name: 'MacTeX (Recommended)',
          steps: [
            '1. Download MacTeX from https://www.tug.org/mactex/',
            '2. Open the downloaded .pkg file',
            '3. Follow the installation wizard',
            '4. Biber is included by default',
            '5. Restart your terminal/application'
          ],
          downloadUrl: 'https://www.tug.org/mactex/mactex-download.html'
        },
        {
          name: 'Homebrew',
          steps: [
            '1. Open Terminal',
            '2. Run: brew install biber',
            '3. Wait for installation to complete',
            '4. Verify with: biber --version'
          ],
          command: 'brew install biber'
        }
      ]
    },
    linux: {
      title: 'Install Biber on Linux',
      methods: [
        {
          name: 'Ubuntu/Debian',
          steps: [
            '1. Open Terminal',
            '2. Run: sudo apt-get update',
            '3. Run: sudo apt-get install biber',
            '4. Verify with: biber --version'
          ],
          command: 'sudo apt-get install biber'
        },
        {
          name: 'Fedora/RHEL',
          steps: [
            '1. Open Terminal',
            '2. Run: sudo dnf install biber',
            '3. Verify with: biber --version'
          ],
          command: 'sudo dnf install biber'
        },
        {
          name: 'Arch Linux',
          steps: [
            '1. Open Terminal',
            '2. Run: sudo pacman -S biber',
            '3. Verify with: biber --version'
          ],
          command: 'sudo pacman -S biber'
        }
      ]
    }
  };

  return instructions[platform] || instructions.linux;
}

/**
 * Display installation instructions
 */
export function displayInstallationInstructions() {
  const instructions = getInstallationInstructions();

  console.log('\n' + '='.repeat(70));
  console.log(`📚 ${instructions.title}`);
  console.log('='.repeat(70) + '\n');

  instructions.methods.forEach((method, index) => {
    console.log(`\n${index + 1}. ${method.name}`);
    console.log('-'.repeat(70));

    method.steps.forEach(step => {
      console.log(`   ${step}`);
    });

    if (method.downloadUrl) {
      console.log(`   \n   🔗 Download: ${method.downloadUrl}`);
    }

    if (method.command) {
      console.log(`   \n   💻 Quick Command: ${method.command}`);
    }
  });

  console.log('\n' + '='.repeat(70));
  console.log('After installation, restart this application to use Biber.');
  console.log('='.repeat(70) + '\n');
}

/**
 * Check and provide installation help if needed
 */
export async function ensureBiberInstalled() {
  console.log('🔍 Checking for Biber installation...');

  const result = await checkBiberInstallation();

  if (result.found) {
    console.log(`✅ Biber found at: ${result.path}`);
    if (result.version) {
      const versionMatch = result.version.match(/biber version: ([\d.]+)/i);
      if (versionMatch) {
        console.log(`   Version: ${versionMatch[1]}`);
      }
    }
    return { installed: true, path: result.path };
  } else {
    console.log('❌ Biber not found on this system');
    console.log('\n⚠️  Biber is required for biblatex bibliography processing.');
    console.log('Without Biber, your bibliography citations will not appear.\n');

    displayInstallationInstructions();

    return {
      installed: false,
      instructions: getInstallationInstructions()
    };
  }
}

/**
 * Create a helpful README for Biber installation
 */
export async function createBiberInstallationGuide(outputPath) {
  const instructions = getInstallationInstructions();

  let markdown = `# Installing Biber for Bibliography Support\n\n`;
  markdown += `Biber is a bibliography processor required by biblatex. Without it, your bibliography citations will not appear in the compiled PDF.\n\n`;
  markdown += `## ${instructions.title}\n\n`;

  instructions.methods.forEach((method, index) => {
    markdown += `### Option ${index + 1}: ${method.name}\n\n`;

    method.steps.forEach(step => {
      markdown += `${step}\n`;
    });

    if (method.downloadUrl) {
      markdown += `\n**Download Link:** ${method.downloadUrl}\n`;
    }

    if (method.command) {
      markdown += `\n**Quick Command:**\n\`\`\`bash\n${method.command}\n\`\`\`\n`;
    }

    markdown += `\n`;
  });

  markdown += `## Verification\n\n`;
  markdown += `After installation, verify that Biber is working:\n\n`;
  markdown += `\`\`\`bash\nbiber --version\n\`\`\`\n\n`;
  markdown += `You should see output showing the Biber version number.\n\n`;
  markdown += `## Troubleshooting\n\n`;
  markdown += `If Biber is installed but not found:\n\n`;
  markdown += `1. Make sure the installation directory is in your system PATH\n`;
  markdown += `2. Restart your terminal/application\n`;
  markdown += `3. Try running Biber directly from its installation directory\n\n`;
  markdown += `## Alternative: Use BibTeX instead of biblatex\n\n`;
  markdown += `If you cannot install Biber, consider using traditional BibTeX:\n\n`;
  markdown += `\`\`\`latex\n% Replace this:\n\\\\usepackage[backend=biber,style=ieee]{biblatex}\n\\\\addbibresource{references.bib}\n\n% With this:\n\\\\usepackage[numbers]{natbib}\n\\\\bibliographystyle{ieeetr}\n\n% And at the end of your document, replace:\n\\\\printbibliography\n\n% With:\n\\\\bibliography{references}\n\`\`\`\n\n`;

  try {
    await fs.writeFile(outputPath, markdown, 'utf-8');
    console.log(`✅ Installation guide created at: ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.error(`❌ Failed to create installation guide: ${err.message}`);
    return null;
  }
}
