const http = require('http')
const path = require('path')
const express = require('express')
const socketIo = require('socket.io')
const needle = require('needle')
const config = require('dotenv').config()
const TOKEN = process.env.TWITTER_BEARER_TOKEN
const PORT = process.env.PORT || 3000

const key = process.env.KRAKEN_API_KEY // API Key
const secret = process.env.KRAKEN_SECRET_KEY // API Private Key
const KrakenClient = require('kraken-api')
const kraken = new KrakenClient(key, secret)

const app = express()

const server = http.createServer(app)
const io = socketIo(server)

app.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../', 'client', 'index.html'))
})

const rulesURL = 'https://api.twitter.com/2/tweets/search/stream/rules'
const streamURL =
    'https://api.twitter.com/2/tweets/search/stream?tweet.fields=public_metrics&expansions=author_id'

const rules = [{ value: '(doge OR dogecoin) (from:elonmusk)' }]

// Get stream rules
async function getRules() {
    const response = await needle('get', rulesURL, {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
        },
    })
    console.log(response.body)
    return response.body
}

// Set stream rules
async function setRules() {
    const data = {
        add: rules,
    }

    const response = await needle('post', rulesURL, data, {
        headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${TOKEN}`,
        },
    })

    return response.body
}

// Delete stream rules
async function deleteRules(rules) {
    if (!Array.isArray(rules.data)) {
        return null
    }

    const ids = rules.data.map((rule) => rule.id)

    const data = {
        delete: {
            ids: ids,
        },
    }

    const response = await needle('post', rulesURL, data, {
        headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${TOKEN}`,
        },
    })

    return response.body
}

function streamTweets(socket) {
    const stream = needle.get(streamURL, {
        headers: {
            Authorization: `Bearer ${TOKEN}`,
        },
    })

    stream.on('data', (data) => {
        try {
            // BUY DOGE HERE AND SET TIMER TO SELL
            const json = JSON.parse(data)
            console.log(json)
            placeDogeBuyOrder()
            socket.emit('tweet', json)
        } catch (error) {
        }
    })

    return stream
}

async function getUSDBalance() {
    let usdBalance = (await kraken.api('Balance')).result.ZUSD
    console.log('usdBalance', usdBalance)
    return usdBalance
}

async function placeDogeBuyOrder() {
    let userDollarBalance = getUSDBalance()

    // Get Ticker Info
    const tickerInfo = await kraken.api('Ticker', { pair: 'DOGEUSD' })

    console.log(tickerInfo.result['XDGUSD'])

    const currentDogePrice = parseFloat(tickerInfo.result['XDGUSD'].a[0])
    //
    console.log({ currentDogePrice })

    const volume = 50 //min volume for doge
    const price = currentDogePrice.toFixed(7)
    if (userDollarBalance < volume * price) {
        console.log('Balance too low, not placing')
        return
    }
    try {
        const result = await kraken.api('AddOrder', {
            pair: 'DOGEUSD',
            type: 'buy',
            ordertype: 'limit',
            price,
            volume,
            close: {
                ordertype: 'take-profit-limit',
                price: '#4.5%',
                price2: '#3%',
            }
        })
        // ORDER ADDED successfully
        console.log(result.result.descr)
    } catch (err) {
        console.error(err)
    }
}

async function start() {
    let currentRules

    try {
        //   Get all stream rules
        currentRules = await getRules()

        // Delete all stream rules
        await deleteRules(currentRules)

        // Set rules based on array above
        await setRules()
    } catch (error) {
        console.error(error)
        process.exit(1)
    }

    const filteredStream = streamTweets(io)

    let timeout = 0
    filteredStream.on('timeout', () => {
        // Reconnect on error
        console.warn('A connection error occurred. Reconnecting…')
        setTimeout(() => {
            timeout++
            streamTweets(io)
        }, 2 ** timeout)
        streamTweets(io)
    })
}

start()

server.listen(PORT, () => console.log(`Listening on port ${PORT}`))
