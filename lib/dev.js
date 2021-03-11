import fs from 'fs'
import { dirname, resolve } from 'path'
import { createRequire } from 'module'
import pkgDir from 'pkg-dir'
const { readlink } = fs.promises

const { DESIGN_MODE = 1 } = process.env

if (~~DESIGN_MODE) dev()
else dev.module = null

async function findProjectDir () {
  try {
    return await pkgDir(resolve(dirname(process.argv[1]), dirname(await readlink(process.argv[1]))))
  } catch {
    return pkgDir(process.argv[1])
  }
}

export default async function dev () {
  if (dev.module || dev.module === null) return dev.module
  try {
    const projectDir = await findProjectDir()
    const { resolve } = createRequire(projectDir)
    dev.module = await import(resolve('clif-dev'))
    return dev.module
  } catch {
    dev.module = null
  }
}
