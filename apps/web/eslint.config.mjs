import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'
import { defineConfig, globalIgnores } from 'eslint/config'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// eslint-config-next (15.x) ships legacy .eslintrc-style configs, so we
// bridge them into flat config via FlatCompat.
const compat = new FlatCompat({ baseDirectory: __dirname })

export default defineConfig([
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  globalIgnores([
    '.next/**',
    'node_modules/**',
    'out/**',
    'next-env.d.ts',
    // JS config files
    'tailwind.config.js',
    'postcss.config.js',
    'next.config.mjs',
  ]),
])