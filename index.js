import fs from 'fs'
import { join, basename } from 'path'
import { spawnSync } from 'child_process'
import commist from 'commist'
import minimist from 'minimist'
import bloomrun from 'bloomrun'
import AggregateError from 'es-aggregate-error'

const { opendir } = fs.promises

const { constructor: GeneratorFunction } = function * () {}
const { constructor: AsyncGeneratorFunction } = async function * () {}

process.on('SIGINT', () => process.exit(130))

const flagerify = (name) => name.replace(/^\$/, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()


const version = async (matcher) => {
  const { default: pkg } = await import('./package.cjs')
  const { name, version } = pkg
  const display = matcher.lookup({ ns: 'version', clif: { name, version } })
  if (display) return display()
  console.log(name, version)
}

const handle = ({ bin, command, settings, parents, meta, matcher, fallthrough }, done) => {
  const { positionals: posDec = [], default: director } = meta
  const config = Object.entries(meta)
    .filter(([[ch1]]) => ch1 === '$')
    .map(([name, info]) => [flagerify(name), info])
    .reduce((o, [name, { type, alias, initial }]) => {
      if (type === 'string') o.string.push(name)
      if (type === 'boolean') o.boolean.push(name)
      if (alias) o.alias[name] = alias
      if (initial) o.default[name] = initial
      return o
    }, {
      string: [],
      boolean: ['help', 'version'],
      alias: { help: 'h', version: 'v' },
      default: {},
      '--': true
    })

  if (!director) {
    return async (argv) => {
      const { version: showVersion } = minimist(argv, config)
      if (showVersion) {
        await version(matcher)
        return
      }

      if (meta.$.fallthrough && fallthrough) {
        await fallthrough(argv)
        return
      }

      await help({ bin, command, settings, parents, meta, matcher })(argv)
    }
  }

  return async (argv) => {
    try {
      const implicits = {
        flags: { raw: [] }
      }
      const { _: args, '--': posteriors = [], help: showHelp, version: showVersion, ...flags } = minimist(argv, {
        ...config,
        unknown (flag) {
          if (flag[0] !== '-') return true
          implicits.flags.raw.push(flag)
          return false
        }
      })

      if (showVersion) {
        await version(matcher)
        return
      }

      if (showHelp) {
        await help({ bin, command, settings, parents, meta, matcher })(argv)
        return
      }

      implicits.positionals = args.slice(posDec.length)
      const positionals = Object.fromEntries(
        Object.entries(posDec).map(([ix, name]) => {
          return [name, args[ix]]
        })
      )

      const inputs = {
        ...flags,
        ...positionals
      }

      implicits.flags.parsed = minimist(implicits.flags.raw)

      const iter = await director({ inputs, settings, implicits, posteriors })

      try {
        let value
        while (true) {
          const { value: pattern, done } = await iter.next(value)
          if (done) break
          const action = matcher.iterator(pattern).next()
          if (typeof action !== 'function') {
            value = undefined
            continue
          }
          value = await action(pattern, settings)
        }
        done()
      } catch (err) {
        const action = matcher.iterator(err).next()
        if (typeof action !== 'function') throw err
        await action(err, settings)
        done()
      }
    } catch (err) {
      done(err)
    }
  }
}

function * validate (command, { default: director, describe, positionals, ...exports }) {
  const isGenerator = director instanceof AsyncGeneratorFunction || director instanceof GeneratorFunction
  const prefix = `Command "${command}"`
  if (isGenerator === false) {
    yield SyntaxError(`${prefix} default export must be a generator function or async generator function`)
  }
  if (typeof describe !== 'string' || describe.length === 0) {
    yield SyntaxError(`${prefix} describe export is required and must be a string of non-zero length`)
  }
  if (positionals && Array.isArray(positionals) === false) {
    yield SyntaxError(`${prefix} positionals export must be an array`)
  }
  for (const name of Object.keys(exports)) {
    if (name[0] !== '$') continue
    const { describe, type, alias = '' } = exports[name]
    if (typeof describe !== 'string' || describe.length === 0) {
      yield SyntaxError(`${prefix}, flag "${name}" describe property is required and must be a string of non-zero length`)
    }
    if (type !== 'boolean' && type !== 'string') {
      yield SyntaxError(`${prefix}, flag "${name}" type property is required and must have the value "boolean" or "string"`)
    }
    if (typeof alias !== 'string' && Array.isArray(alias) === false) {
      yield SyntaxError(`${prefix}, flag "${name}" alias property must be a string or an array`)
    }
    if (Array.isArray(alias) && alias.some((s) => typeof s !== 'string')) {
      yield SyntaxError(`${prefix}, flag "${name}" when alias property is an array, all elements must be strings`)
    }
  }
}

function define ({ command, parents, handler, program }) {
  if (parents.length > 0) {
    const cmd = [...parents, command]
    program.register({ command: cmd.join(':'), strict: true }, handler)
    program.register(cmd.join(' '), handler)
  } else {
    program.register(command, handler)
  }
}

const helpify = {
  positionals (definitions) {
    if (definitions.length === 0) return ''
    return definitions.map(({ required, name }) => {
      return required ? `<${name}>` : `[${name}]`
    }).join(' ')
  },
  flags (definitions) {
    if (definitions.length === 0) return ''
    return '\n' + definitions.map(({ required, name, alias, type, describe }) => {
      alias = Array.isArray(alias) ? alias.join(' | ') : alias
      const alt =  alias ? ` | ${alias} ` : ' '
      const flag = required ? `< ${name}${alt}>` : `[ ${name}${alt}]`
      return `${flag} - ${describe} (${type}) `
    }).join('\n') + '\n'
  },
  command (name) {
    return name ? name + ' ' : ''
  },
  subcommands (definitions, { bin, command, breadcrumb }) {
    if (definitions.length === 0) return ''
    return '\n' + definitions.map(({name, describe }) => {
      const cmd = helpify.command(command.name)
      return `${bin}${helpify.breadcrumb(breadcrumb)}${cmd}${name} – ${describe}`
    }).join('\n') + '\n'
  },
  breadcrumb (definitions) {
    return definitions.length > 0 ? ` ${definitions.join(' ')} ` : ' '
  },
  unrecognized (argv, { bin, breadcrumb, command }) {
    if (argv.length === 0) return ''
    const cmd = helpify.command(command.name)
    return `\nCommand not recognized: ${bin}${helpify.breadcrumb(breadcrumb)}${cmd}${argv.join(' ')}\n`
  }
}

const usage = ({ bin, command, subcommands, breadcrumb, unrecognized }) => `${helpify.unrecognized(unrecognized, {bin, breadcrumb, command})}
${command.describe}

${bin}${helpify.breadcrumb(breadcrumb)}${helpify.command(command.name)}${helpify.positionals(command.positionals)}
${helpify.flags(command.flags)}${helpify.subcommands(subcommands, { bin, command, breadcrumb })}`

const dashify = (flag) => {
  return (flag.length === 1) ? `-${flag}` : `--${flag}`
}

const flagInfo = (meta) => {
  return Object.entries(meta).filter(([k]) => k !== '$' && k[0] === '$').map(([k, v]) => {
    const name = dashify(flagerify(k))
    const alias = Array.isArray(v.alias) ? v.alias.map(flagerify).map(dashify) : dashify(flagerify(v.alias))
    
    return {
      name,
      ...v,
      alias
    }
  })
}

const positionalInfo = (positionals = []) => {
  return positionals.map((positional) => {
    const required = positional[0] === '<'
    return { name: positional.replace(/[<|\[](.+)[>|\]]/, '$1'), required }
  })
}

const help = ({ bin = '', command, meta, parents = [], matcher }) => {
  return async (argv) => {
    const unrecognized = argv.filter((arg) => arg !== '--help' && arg !== '-h')
    const isLeaf = meta.default

    if (isLeaf) {
      const { describe, positionals = [] } = meta
      const flags = flagInfo(meta)
      const positionalDefs = positionalInfo(positionals)
      const commandDef = { name: command, describe, positionals: positionalDefs, flags, leaf: true }
      const pattern =  { ns: 'help', bin, argv, command: commandDef, subcommands: [], breadcrumb: parents, unrecognized }
      const display = matcher.lookup(pattern) || ((pattern) => console.log(usage(pattern)))
      await display(pattern)
      return
    }
  
    const { describe } = meta.$
    const subcommands = Object.entries(meta).filter(([k]) => k !== '$').map(([subcommand, declaration]) => {
      const { $, describe = $.describe, positionals = [] } = declaration
      const flags = flagInfo(declaration)
      const positionalDefs = positionalInfo(positionals)
      const leaf = !!declaration.default
      return { name: subcommand, describe, positionals: positionalDefs, flags, leaf }
    })

    const positionalDefs = positionalInfo(['<command>'])
    const commandDef = { name: command, describe, positionals: positionalDefs, flags: [], leaf: true }
    const pattern =  { ns: 'help', bin, argv, command: commandDef, describe, subcommands, breadcrumb: parents, unrecognized }
    const display = matcher.lookup(pattern) || ((pattern) => console.log(usage(pattern)))
    await display(pattern)
  }
}

async function compose ({ bin, structure, settings, matcher, program = commist(), parents = [], errors, fallthrough, done }) {
  for (const [command, meta] of Object.entries(structure)) {
    if (command === '$') continue
    if (meta.default) {
      const errs = [...validate(command, meta)]
      if (errs.length > 0) {
        errors.push(...errs)
        continue
      }
      const handler = handle({ bin, command, settings, parents, meta, matcher }, done)
      define({ command, parents, handler, program })
      continue
    } else {
      if (!meta.$ || typeof meta.$.describe !== 'string') {
        errors.push(SyntaxError(`Command ${command} is missing a description (needs $.describe)`))
      }
      const handler = handle({ bin, command, settings, parents, meta, matcher, fallthrough }, done)
      define({ command, parents, handler, program })
    }
    await compose({ bin, structure: meta, settings, matcher, program, parents: [...parents, command], errors, fallthrough, done })
  }
  return program
}

async function loadStructure (dir) {
  const structure = {}
  for await (const command of await opendir(dir)) {
    if (command.isDirectory()) {
      structure[command.name] = await loadStructure(join(dir, command.name))
    }
    const [ext, name] = command.name.split('.').reverse()
    if (ext !== 'js' && ext !== 'mjs') continue
    const path = join(dir, command.name)
    try {
      structure[name] = await import(path)
    } catch (err) {
      if (err instanceof SyntaxError) {
        const { stderr } = spawnSync(process.execPath, [join(dir, command.name), '-c'], { encoding: 'utf-8' })
        throw stderr
      }
      throw err
    }
  }
  return structure
}

async function loadPatterns (dir, errors) {
  const patterns = []
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
        patterns.push([pattern, actions[name]])
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        const { stderr } = spawnSync(process.execPath, [path, '-c'], { encoding: 'utf-8' })
        throw stderr
      }
      throw err
    }
  }
  return patterns
}

export class Fail extends Error {
  constructor (pattern = {}, message) {
    if (typeof pattern === 'string') {
      message = pattern
      pattern = {}
    }
    message = pattern.message || message
    if (!pattern.ns) pattern.ns = 'failure'
    super(message)
    for (const key of Object.keys(pattern)) {
      this[key] = pattern[key]
    }
  }
}

export default function clif (
  { bin = basename(process.argv[1]), structure, settings, patterns, fallthrough },
  argv = process.argv.slice(2)
) {
  const matcher = bloomrun({ indexing: 'depth' })
  let resolve = null
  let reject = null
  const propagator = new Promise((rs, rj) => { // eslint-disable-line
    resolve = rs
    reject = rj
  })
  const done = (err) => err ? reject(err) : resolve(register)

  register(Error, () => Fail)

  async function build () {
    try {
      const errors = []
    
      if (typeof patterns === 'string') patterns = loadPatterns(patterns, errors)
      if (typeof structure === 'string') structure = loadStructure(structure)

      patterns = await patterns

      if (Array.isArray(patterns) === false || patterns.some((pattern) => Array.isArray(pattern) === false)) {
        const err = new SyntaxError('The patterns input must be a string or an array of arrays')
        err.patterns = patterns
        throw err
      }
      
      for (const [pattern, action] of patterns) {
        if (typeof action !== 'function') {
          const err = new SyntaxError('All pattern actions must be functions')
          err.pattern = pattern
          err.action = action
          errors.push(err)
        }
        register(pattern, action)
      }
      
      structure = await structure
      settings = await settings

      const program = await compose({ bin, structure, settings, matcher, errors, fallthrough, done })
      
      if (errors.length > 0) throw AggregateError(errors)

      const handler = handle({ bin, command: '', settings, parents: [], meta: structure, matcher, fallthrough }, done)
      program.handler = handler

      const [ first ] = argv
      if (first === '-h' || first === '--help') {
        argv.shift()
        argv.push('--help')
      }

      return program
    } catch (err) {
      done(err)
    }
  }

  const building = build()
  let started = false

  function register (pattern, action) {
    matcher.add(pattern, action)
    return register
  }

  async function start () {
    if (started === true) return
    started = true
    try {
      const program = await building

      const parsed = program.parse(argv)
      if (parsed === argv) await program.handler(argv)

    } catch (err) {
      reject(err)
    }
  }

  register.then = async (...args) => {
    const thener = propagator.then(...args)
    await start()
    return thener
  }
  register.catch = async (...args) => {
    const catcher = propagator.catch(...args)
    await start()
    return catcher
  }
  register.finally = (...args) => propagator.finally(...args)

  return register
}
