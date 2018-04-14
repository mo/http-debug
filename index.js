const chalk = require('chalk')
const commander = require('commander')

function bufferToHex(buffer) {
  const hexBody = buffer.toString('hex')
  const hexBodyWithSpaces = [...Array(hexBody.length / 2)].map((v, i) => hexBody.slice(2*i, 2*(i + 1))).join(' ')
  return hexBodyWithSpaces
}

commander
  .option('-b, --body [format]', 'body output format [text|raw|hex]', /^(text|raw|hex)$/i, 'text')
  .parse(process.argv)

const port = 9191

const server = require('http').createServer((req, res) => {

    const timestamp = new Date().toISOString()

    console.log(`---[ request received ${timestamp} ]----------------------------------------------`)
    console.log(chalk.cyan(req.method) + ' ' + chalk.blueBright(req.url))
    console.log('')
    Object.entries(req.headers).forEach(([k,v]) => {
      console.log(chalk.cyan(k) + ': ' + chalk.blueBright(v))
    })
    console.log('')
    const data = []
    req.on('data', (chunk) => {
      data.push(chunk)
    }).on('end', () => {
      const bodyBuffer = Buffer.concat(data)
      const bodyUtf8 = bodyBuffer.toString('utf8')
      if (commander.body === 'text' && /[\x00-\x08\x0E-\x1F]/.test(bodyUtf8)) {
        console.log(chalk.green(`body contains ${chalk.blueBright(bodyBuffer.byteLength)} bytes of binary data (re-run with "--body hex" or "--body raw" to see binary data)`))
      } else if (commander.body === 'hex') {
        console.log(chalk.blueBright(bufferToHex(bodyBuffer)))
      } else {
        console.log(chalk.magenta('request body="') + chalk.blueBright(bodyUtf8) + chalk.magenta('"'))
      }
      console.log('\n')
    })

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
      res.setHeader("Access-Control-Allow-Headers", req.headers['access-control-request-headers'])
    } else {
      res.setHeader("Access-Control-Allow-Headers", '*')
    }

    // "Access-Control-Max-Age: -1" means don't cache CORS pre-flight requests at all:
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
    res.setHeader('Access-Control-Max-Age', -1)

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    res.writeHead(200)
    res.end('Request logged.')
})

server.listen(port, (err) => {
  if (err) {
    return console.log(`ERROR: failed to open listen port ${port}, error was: ${err}`)
  }
  console.log(`Server is listening on port ${port}`)
})
