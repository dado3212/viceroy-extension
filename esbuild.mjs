import esbuild from 'esbuild';
import { copy, emptyDir } from 'fs-extra';

await emptyDir('dist');
await copy('public', 'dist');

const common = {
  bundle: true,
  minify: false,
  sourcemap: true,
  target: 'es2022',
  outdir: 'dist',
  format: 'esm',
};

await esbuild.build({
  entryPoints: {
    'background': 'src/background.ts',
    'app': 'src/app.ts',
  },
  ...common,
});