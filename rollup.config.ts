
import typescript from '@rollup/plugin-typescript';

export default {
    input: 'src/index.ts',
    plugins: [
        typescript({
            sourceMap: true,
        })
    ],
    output: [
        {
            dir: 'dist',
            format: 'cjs',
            preserveModules: true,
            entryFileNames: '[name].cjs',
        },
        {
            dir: 'dist',
            format: 'es',
            preserveModules: true,
            entryFileNames: '[name].mjs',
        }
    ]
}