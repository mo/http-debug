const chalk = require('chalk')
const commander = require('commander')
const http = require('http')
const https = require('https')

function bufferToHex(buffer) {
  const hexBody = buffer.toString('hex')
  const hexBodyWithSpaces = [...Array(hexBody.length / 2)].map((v, i) => hexBody.slice(2 * i, 2 * (i + 1))).join(' ')
  return hexBodyWithSpaces
}

function printBodyBuffer(bodyBuffer) {
  const bodyUtf8 = bodyBuffer.toString('utf8')
  if ((commander.body === 'text' || commander.body === 'text-maxlen') && /[\x00-\x08\x0E-\x1F]/.test(bodyUtf8)) {
    console.log(
      chalk.green(
        `body contains ${chalk.blueBright(
          bodyBuffer.byteLength
        )} bytes of binary data (re-run with "--body hex" or "--body raw" or "--body printable" to see binary data)`
      )
    )
  } else if (commander.body === 'text-maxlen') {
    const bodyMaxLength = Number(commander.bodyMaxLength)
    if (bodyBuffer.byteLength > bodyMaxLength) {
      const truncatedBodyBuffer = bodyBuffer.slice(0, bodyMaxLength)
      const truncatedBodyText = truncatedBodyBuffer.toString('utf8')
      console.log(
        chalk.red('"') +
          chalk.blueBright(truncatedBodyText) +
          chalk.red(
            `"\n(print-out truncated at ${bodyMaxLength} bytes, use --body-max-length N to adjust truncation limit)`
          )
      )
    } else {
      console.log(chalk.red('"') + chalk.blueBright(bodyUtf8) + chalk.red('"'))
    }
  } else if (commander.body === 'hex') {
    console.log(chalk.blueBright(bufferToHex(bodyBuffer)))
  } else if (commander.body === 'printable') {
    const coloredPrintableBody = bodyBuffer
      .toString('ascii')
      .split('')
      .map((ch) => {
        if (/[\x00-\x09\x0B-\x0C\x0E-\x1F\x80-\xFF]/.test(ch)) {
          return chalk.red('?')
        } else {
          return chalk.blueBright(ch)
        }
      })
      .join('')
    console.log(coloredPrintableBody)
  } else {
    console.log(chalk.red('"') + chalk.blueBright(bodyUtf8) + chalk.red('"'))
  }
  console.log('')
}

function addCorsResponseHeaders(req, res) {
  if (req.headers['origin']) {
    // NOTE: "Access-Control-Allow-Origin: *" is NOT sufficient for
    // requests with "Access-Control-Allow-Credentials: true", for these cases
    // you have to return the value from the "origin:" request header,
    // otherwise the pre-flight request will fail.
    res.setHeader('Access-Control-Allow-Origin', req.headers['origin'])
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  res.setHeader('Access-Control-Allow-Credentials', true)

  if (req.headers['access-control-request-headers']) {
    res.setHeader('Access-Control-Allow-Methods', req.headers['access-control-request-method'])
  } else {
    res.setHeader('Access-Control-Allow-Methods', '*')
  }

  if (req.headers['access-control-request-headers']) {
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'])
  } else {
    res.setHeader('Access-Control-Allow-Headers', '*')
  }

  // "Access-Control-Max-Age: -1" means don't cache CORS pre-flight requests at all:
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
  res.setHeader('Access-Control-Max-Age', -1)
}

function printRequest(req, requestBodyBuffer) {
  const timestamp = new Date().toISOString()

  console.log(`===[ request received ${timestamp} ]================================================`)
  console.log(chalk.cyan(req.method) + ' ' + chalk.blueBright(req.url))
  console.log('')
  Object.entries(req.headers).forEach(([k, v]) => {
    console.log(chalk.cyan(k) + ': ' + chalk.blueBright(v))
  })
  console.log('')
  printBodyBuffer(requestBodyBuffer)
}

function printResponse(res, responseBodyBuffer) {
  console.log('------------------------------------------------------------------------------------------------')
  console.log(chalk.cyan(res.statusCode) + ' ' + chalk.blueBright(res.statusMessage))
  console.log('')
  Object.entries(res.headers).forEach(([k, v]) => {
    console.log(chalk.cyan(k) + ': ' + chalk.blueBright(v))
  })
  console.log('')
  printBodyBuffer(responseBodyBuffer)
}

async function readBody(stream) {
  return new Promise((resolve, reject) => {
    const data = []
    stream.on('error', (err) => reject(err))
    stream.on('data', (chunk) => {
      data.push(chunk)
    })
    stream.on('end', () => {
      const bodyBuffer = Buffer.concat(data)
      resolve(bodyBuffer)
    })
  })
}

async function logAndProxyRequest(req, res) {
  console.log(`connecting to proxy at: ${commander.targetScheme}: ${commander.targetHost} ${commander.targetPort}`)
  const headers = req.headers
  Object.keys(headers).forEach((key) => {
    if (key.toLowerCase() === 'host') {
      headers[key] = commander.targetHost
    }
  })
  const targetReq = (commander.targetScheme == 'http' ? http : https).request({
    protocol: `${commander.targetScheme}:`,
    hostname: commander.targetHost,
    port: commander.targetPort,
    path: req.url,
    method: req.method,
    headers,
  })

  const requestBodyBuffer = await readBody(req)
  targetReq.write(requestBodyBuffer)
  targetReq.end()

  targetReq.on('error', (err) => {
    console.log(`ERROR: Could not forward request to ${commander.targetHost}:${commander.targetPort}, details: ${err} `)
    res.end()
  })
  targetReq.on('response', async (targetRes) => {
    res.writeHead(targetRes.statusCode, targetRes.headers)

    const responseBodyBuffer = await readBody(targetRes)
    res.write(responseBodyBuffer)
    res.end()

    printRequest(req, requestBodyBuffer)
    printResponse(targetRes, responseBodyBuffer)
  })
}

async function logRequest(req, res) {
  const requestBodyBuffer = await readBody(req)
  printRequest(req, requestBodyBuffer)

  res.writeHead(200)
  res.end('Request logged.')
}

commander
  .option('-c, --cors', 'always return "allow everything" CORS headers')
  .option(
    '-b, --body [format]',
    'body output format [text|raw|hex|printable]',
    /^(text|text-maxlen|raw|hex|printable)$/i,
    'text-maxlen'
  )
  .option('-m, --body-max-length [byte_length]', 'body max length', 1000)
  .option('-l, --listen-port [port]', 'listen port', /\d{1,5}/, 9191)
  .option('-h, --target-host [host]', 'proxy target host', 'localhost')
  .option('-p, --target-port [port]', 'proxy target port', /\d{1,5}/)
  .option('-s, --target-scheme [scheme]', 'proxy target scheme', 'http')
  .parse(process.argv)

if (!['http', 'https'].includes(commander.targetScheme)) {
  console.log(`ERROR: invalid --target-scheme ${commander.targetScheme}`)
  process.exit(1)
}

const server = http.createServer((req, res) => {
  if (commander.cors) {
    addCorsResponseHeaders(req, res)
  }

  if (commander.targetHost && commander.targetPort) {
    logAndProxyRequest(req, res)
  } else {
    logRequest(req, res)
  }
})

server.listen(commander.listenPort, (err) => {
  if (err) {
    return console.log(`ERROR: failed to open listen port ${commander.listenPort}, error was: ${err}`)
  }
  console.log(`Proxy is listening on port ${commander.listenPort}`)
})
