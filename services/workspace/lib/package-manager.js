// SPDX-License-Identifier: MIT

// Use dynamic imports for Node.js modules to avoid client-side bundling issues
let fsPromise = null;
let pathModule = null;

/**
 * Lazy load fs/promises (server-side only)
 */
async function getFs() {
  if (typeof window === 'undefined' && !fsPromise) {
    fsPromise = import('fs/promises');
  }
  return fsPromise ? (await fsPromise).default : null;
}

/**
 * Lazy load path (server-side only)
 */
async function getPath() {
  if (typeof window === 'undefined') {
    if (!pathModule) {
      pathModule = await import('path');
    }
    return pathModule.default || pathModule;
  }
  return null;
}

/**
 * LaTeX Package Manager
 * Handles automatic package detection, extraction, and missing package detection
 * Also manages per-project package manifests
 */
export class PackageManager {
  constructor() {
    // Popular/common LaTeX packages that should be pre-warmed
    this.popularPackages = [
      'amsmath', 'amsfonts', 'amssymb', 'amsthm',
      'graphicx', 'xcolor', 'hyperref', 'url',
      'booktabs', 'array', 'longtable', 'tabularx',
      'geometry', 'fancyhdr', 'titlesec',
      'enumitem', 'listings', 'verbatim',
      'caption', 'subcaption', 'float',
      'tikz', 'pgfplots', 'babel',
      'inputenc', 'fontenc', 'lmodern',
      'biblatex', 'natbib'
    ];

    // Command to package mapping
    this.commandToPackage = {
      'includegraphics': 'graphicx',
      'url': 'url',
      'href': 'hyperref',
      'toprule': 'booktabs',
      'midrule': 'booktabs',
      'bottomrule': 'booktabs',
      'algorithm': 'algorithm',
      'algorithmic': 'algorithmic',
      'lstlisting': 'listings',
      'minted': 'minted',
      'tikzpicture': 'tikz',
      'pgfplotstableread': 'pgfplots',
      'DeclareMathOperator': 'amsmath',
      'mathbb': 'amssymb',
      'mathcal': 'amssymb',
      'mathfrak': 'amssymb',
      'usepackage': null, // Skip this one
      'documentclass': null, // Skip this one
      'printbibliography': 'biblatex',
      'addbibresource': 'biblatex',
      'bibliography': 'natbib',
      'natbib': 'natbib',
      'cite': 'natbib',
      'textcolor': 'xcolor',
      'color': 'xcolor',
      'multicolumn': 'array',
      'multirow': 'multirow',
      'caption': 'caption',
      'subcaption': 'subcaption',
      'subfigure': 'subfigure'
    };

    // Package dependencies - packages that require other packages
    this.packageDependencies = {
      'tikz': ['pgf', 'xcolor'],
      'pgfplots': ['tikz', 'pgf'],
      'subcaption': ['caption'],
      'subfigure': ['caption'],
      'biblatex': [], // Biber is external tool, not a package
      'hyperref': ['url']
    };
  }

  /**
   * Extract all package declarations from LaTeX content
   * @param {string} texContent - LaTeX document content
   * @returns {Array<string>} Array of package names
   */
  extractPackages(texContent) {
    if (!texContent) return [];

    const packages = new Set();
    
    // Match \usepackage[...]{package} and \usepackage{package}
    // Also handle comma-separated packages: \usepackage{package1,package2}
    // Improved regex to handle various whitespace and line breaks
    const packageRegex = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    
    let match;
    while ((match = packageRegex.exec(texContent)) !== null) {
      const packageList = match[1];
      // Split by comma and trim each package name
      const packageNames = packageList.split(',').map(pkg => pkg.trim());
      packageNames.forEach(pkg => {
        if (pkg && pkg.length > 0) {
          packages.add(pkg);
        }
      });
    }

    // Extract packages from RequirePackage (used in classes/packages)
    const requireRegex = /\\RequirePackage\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
    while ((match = requireRegex.exec(texContent)) !== null) {
      const packageList = match[1];
      const packageNames = packageList.split(',').map(pkg => pkg.trim());
      packageNames.forEach(pkg => {
        if (pkg && pkg.length > 0) {
          packages.add(pkg);
        }
      });
    }

    // Extract document class packages (some classes implicitly load packages)
    const docClassRegex = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/;
    const docClassMatch = texContent.match(docClassRegex);
    if (docClassMatch && docClassMatch[1]) {
      const className = docClassMatch[1].trim();
      // Add known document class package dependencies
      const classDependencies = this.getClassDependencies(className);
      classDependencies.forEach(pkg => packages.add(pkg));
    }

    return Array.from(packages);
  }

  /**
   * Get package dependencies for common document classes
   * @param {string} className - Document class name
   * @returns {Array<string>} Array of package dependencies
   */
  getClassDependencies(className) {
    const dependencies = {
      'beamer': ['xcolor', 'graphicx', 'hyperref'],
      'memoir': ['array', 'dcolumn', 'delarray', 'tabularx'],
      'article': [], // Standard class, no extra dependencies
      'report': [],
      'book': [],
      'letter': []
    };
    
    return dependencies[className] || [];
  }

  /**
   * Detect missing packages from compilation log errors
   * @param {string} logText - LaTeX compilation log (pdflatex)
   * @returns {Array<string>} Array of missing package names
   */
  detectMissingPackages(logText) {
    if (!logText) return [];

    const missingPackages = new Set();
    const lines = logText.split('\n');

    // Patterns to detect missing packages
    const patterns = [
      // "File `package.sty' not found"
      /File\s+[`'"]?([a-zA-Z0-9_-]+)\.sty['"]?\s+not\s+found/i,
      // "Package package not found"
      /Package\s+([a-zA-Z0-9_-]+)\s+not\s+found/i,
      // "LaTeX Error: File `package.cls' not found"
      /LaTeX\s+Error:\s*File\s+[`'"]?([a-zA-Z0-9_-]+)\.(?:sty|cls)['"]?\s+not\s+found/i,
      // "! LaTeX Error: File `package.sty' not found"
      /!\s+LaTeX\s+Error:\s*File\s+[`'"]?([a-zA-Z0-9_-]+)\.(?:sty|cls)['"]?\s+not\s+found/i,
      // "Missing file: package.sty"
      /Missing\s+file:\s+([a-zA-Z0-9_-]+)\.(?:sty|cls)/i,
      // "I can't find file `package.sty'"
      /I\s+can't\s+find\s+file\s+[`'"]?([a-zA-Z0-9_-]+)\.(?:sty|cls)['"]?/i
    ];

    for (const line of lines) {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match && match[1]) {
          const packageName = match[1].trim();
          // Skip common false positives
          if (packageName && 
              packageName !== 'inputenc' && 
              packageName !== 'fontenc' &&
              packageName.length > 1) {
            missingPackages.add(packageName);
          }
        }
      }
    }

    return Array.from(missingPackages);
  }

  /**
   * Map LaTeX command to required package
   * @param {string} command - LaTeX command name (without backslash)
   * @returns {string|null} Package name or null if not found
   */
  mapCommandToPackage(command) {
    return this.commandToPackage[command] || null;
  }

  /**
   * Extract commands from LaTeX content and map to required packages
   * @param {string} texContent - LaTeX document content
   * @returns {Array<string>} Array of required package names
   */
  extractPackagesFromCommands(texContent) {
    if (!texContent) return [];

    const requiredPackages = new Set();
    
    // Extract all LaTeX commands (backslash followed by letters)
    const commandRegex = /\\([a-zA-Z]+)/g;
    const commands = new Set();
    
    let match;
    while ((match = commandRegex.exec(texContent)) !== null) {
      const command = match[1];
      if (command && command.length > 0) {
        commands.add(command);
      }
    }

    // Map commands to packages
    for (const command of commands) {
      const packageName = this.mapCommandToPackage(command);
      if (packageName) {
        requiredPackages.add(packageName);
      }
    }

    return Array.from(requiredPackages);
  }

  /**
   * Get all required packages from LaTeX content
   * Combines explicitly declared packages and inferred packages from commands
   * @param {string} texContent - LaTeX document content
   * @returns {Array<string>} Array of all required package names
   */
  getAllRequiredPackages(texContent) {
    const explicitPackages = this.extractPackages(texContent);
    const inferredPackages = this.extractPackagesFromCommands(texContent);
    
    // Combine all packages
    const allPackages = new Set([...explicitPackages, ...inferredPackages]);
    
    // Add dependencies for packages
    const packagesWithDeps = new Set(allPackages);
    for (const pkg of allPackages) {
      const deps = this.packageDependencies[pkg];
      if (deps && deps.length > 0) {
        deps.forEach(dep => packagesWithDeps.add(dep));
      }
    }
    
    return Array.from(packagesWithDeps);
  }

  /**
   * Get list of popular/common packages
   * @returns {Array<string>} Array of popular package names
   */
  getPopularPackages() {
    return [...this.popularPackages];
  }

  /**
   * Check if a package is in the popular packages list
   * @param {string} packageName - Package name to check
   * @returns {boolean} True if package is popular
   */
  isPopularPackage(packageName) {
    return this.popularPackages.includes(packageName);
  }

  /**
   * Get package manifest path for a project
   * @param {string} projectDir - Project directory path
   * @returns {Promise<string>} Path to package manifest file
   */
  async getPackageManifestPath(projectDir) {
    const path = await getPath();
    if (!path) {
      throw new Error('Path module not available (client-side)');
    }
    return path.join(projectDir, 'packages.json');
  }

  /**
   * Load package manifest for a project
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Package manifest object
   */
  async loadPackageManifest(projectDir) {
    const fs = await getFs();
    if (!fs) {
      // Return default manifest if fs is not available (client-side)
      return {
        projectId: projectDir.split(/[/\\]/).pop(),
        packages: {
          declared: [],
          inferred: [],
          all: [],
          missing: [],
          lastDetected: null,
          lastUpdated: null
        },
        usage: {},
        version: '1.0.0'
      };
    }
    
    const path = await getPath();
    const manifestPath = path.join(projectDir, 'packages.json');
    try {
      const data = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(data);
      return manifest;
    } catch (error) {
      // Return default manifest if file doesn't exist
      return {
        projectId: path.basename(projectDir),
        packages: {
          declared: [],
          inferred: [],
          all: [],
          missing: [],
          lastDetected: null,
          lastUpdated: null
        },
        usage: {},
        version: '1.0.0'
      };
    }
  }

  /**
   * Save package manifest for a project
   * @param {string} projectDir - Project directory path
   * @param {Object} manifest - Package manifest object
   * @returns {Promise<void>}
   */
  async savePackageManifest(projectDir, manifest) {
    const fs = await getFs();
    if (!fs) {
      console.warn('Cannot save package manifest: fs not available (client-side)');
      return;
    }
    
    const path = await getPath();
    const manifestPath = path.join(projectDir, 'packages.json');
    manifest.lastUpdated = new Date().toISOString();
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  /**
   * Update package manifest with detected packages
   * @param {string} projectDir - Project directory path
   * @param {Object} packageInfo - Package information object
   * @param {Array<string>} packageInfo.declared - Declared packages
   * @param {Array<string>} packageInfo.inferred - Inferred packages
   * @param {Array<string>} packageInfo.missing - Missing packages (optional)
   * @returns {Promise<Object>} Updated manifest
   */
  async updatePackageManifest(projectDir, packageInfo) {
    const manifest = await this.loadPackageManifest(projectDir);
    const { declared = [], inferred = [], missing = [] } = packageInfo;
    
    // Combine all packages
    const allPackages = [...new Set([...declared, ...inferred])];
    
    // Update manifest
    manifest.packages.declared = declared;
    manifest.packages.inferred = inferred;
    manifest.packages.all = allPackages;
    manifest.packages.lastDetected = new Date().toISOString();
    
    // Track missing packages
    if (missing.length > 0) {
      manifest.packages.missing = [...new Set([...manifest.packages.missing, ...missing])];
    }
    
    // Update usage statistics
    const now = new Date().toISOString();
    for (const pkg of allPackages) {
      if (!manifest.usage[pkg]) {
        manifest.usage[pkg] = {
          firstUsed: now,
          lastUsed: now,
          usageCount: 0,
          declared: declared.includes(pkg),
          inferred: inferred.includes(pkg)
        };
      } else {
        manifest.usage[pkg].lastUsed = now;
        manifest.usage[pkg].usageCount += 1;
        manifest.usage[pkg].declared = manifest.usage[pkg].declared || declared.includes(pkg);
        manifest.usage[pkg].inferred = manifest.usage[pkg].inferred || inferred.includes(pkg);
      }
    }
    
    await this.savePackageManifest(projectDir, manifest);
    return manifest;
  }

  /**
   * Get packages from manifest
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Package information from manifest
   */
  async getProjectPackages(projectDir) {
    const manifest = await this.loadPackageManifest(projectDir);
    return manifest.packages;
  }

  /**
   * Get package usage statistics for a project
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Package usage statistics
   */
  async getPackageUsageStats(projectDir) {
    const manifest = await this.loadPackageManifest(projectDir);
    return manifest.usage || {};
  }

  /**
   * Validate package names (basic validation)
   * @param {Array<string>} packages - Array of package names
   * @returns {Array<string>} Array of valid package names
   */
  validatePackages(packages) {
    return packages.filter(pkg => {
      // Basic validation: alphanumeric, underscore, hyphen only
      return /^[a-zA-Z0-9_-]+$/.test(pkg) && pkg.length > 0;
    });
  }
}

// Export singleton instance
export const packageManager = new PackageManager();
