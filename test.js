
const text = `{"oracle.yield":{"new":{"oracle.yield":[{"primaryKey":"10928392561361944576","payer":"myoracle","value":{"oracle":"myoracle","status":"pending","balance":{"quantity":"0.0000 EOS","contract":"eosio.token"},"metadata":[{"key":"name","value":"My Oracle"},{"key":"website","value":"https://myoracle.com"}],"created_at":"2022-07-07T03:28:56","updated_at":"2022-07-07T03:28:56","claimed_at":"1970-01-01T00:00:00"}}]}}}`

const findEndBracket = (str) => {
    let left = 0
    let right = 0

    let index = 0
    let endIndex = -1

    for (char of str) {
        if (char === '{')
            left++
        else if (char === '}')
            right++

        if (left === right) {
            endIndex = index
            break;
        }

        index++
    }

    return endIndex
}

const findStartAndEnd = (text, pattern) => {
    let positions = []
    let index = 0
    while (true) {
        index = text.indexOf(pattern, index)
        if (index === -1) {
            break
        }
        positions.push(index)
        index += pattern.length
    }

    return positions.map(_ => [_, findEndBracket(text, _)])
}

// const newStartAndEnd = newPositions.map(_ => [_, findEndBracket(text, _)])
// const oldStartAndEnd = oldPositions.map(_ => [_, findEndBracket(text, _)])


console.log(findStartAndEnd(text, `{"new":`))
console.log(findStartAndEnd(text, `{"old":`))
