import esbuild from 'esbuild';

// Create the esbuild build configuration
esbuild.build({
  entryPoints: ['dist/index.js'], // Main entry point (change as needed)
  bundle: true, // Enable bundling
  format: 'esm',
  outfile: 'dist/bundle.js', // Output file
  sourcemap: true, // Generate sourcemaps
  minify: true, // Minify the output for production
  external: [], // Exclude specific modules from being bundled (e.g., node_modules)  
  platform: 'node', //node
  sourcemap: true,
  define: {
    global: 'global',
    process: 'process',
    Buffer: 'Buffer'
  },
//   format: 'iife',
  globalName: 'Vert'
}).catch(() => process.exit(1)); // Exit on error