import fs from 'fs'
import { spawnSync } from 'child_process'
import { join } from 'path'
const { opendir } = fs.promises

export async function structure (dir) {
  const result = {}
  for await (const command of await opendir(dir)) {
    if (command.isDirectory()) {
      result[command.name] = await structure(join(dir, command.name))
    }
    const [ext, name] = command.name.split('.').reverse()
    if (ext !== 'js' && ext !== 'mjs') continue
    const path = join(dir, command.name)
    try {
      result[name] = await import(path)
    } catch (err) {
      if (err instanceof SyntaxError) {
        const { stderr } = spawnSync(process.execPath, [join(dir, command.name), '-c'], { encoding: 'utf-8' })
        throw stderr
      }
      throw err
    }
  }
  return result
}

export async function patterns (dir, errors) {
  const result = []
  for await (const ptn of await opendir(dir)) {
    const [ext] = ptn.name.split('.').reverse()
    if (ext !== 'js' && ext !== 'mjs') continue
    const path = join(dir, ptn.name)
    try {
      const mod = await import(path)
      const { default: declarations, ...actions } = mod
      if (!declarations) {
        errors.push(
          new SyntaxError(`Pattern module ${path} must have a default export object`)
        )
        continue
      }
      for (const [name, action] of Object.entries(actions)) {
        if (typeof action !== 'function') continue // ignore non-function exports
        if (typeof declarations[name] !== 'object' || declarations[name] === null) {
          errors.push(
            new SyntaxError(`Pattern module ${path} export \`${name}\` must have a corresponding pattern object of the same name in the default export object`)
          )
        }
      }

      for (const [name, pattern] of Object.entries(declarations)) {
        if (typeof actions[name] !== 'function') {
          errors.push(new SyntaxError(`Pattern module ${path} default export property name \`${name}\` must have a corresponding exported function by the same name`))
          continue
        }
        result.push([pattern, actions[name]])
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        const { stderr } = spawnSync(process.execPath, [path, '-c'], { encoding: 'utf-8' })
        throw stderr
      }
      throw err
    }
  }
  return result
}
