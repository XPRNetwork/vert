const findEndBracket = (str) => {
    let left = 0
    let right = -1

    let index = 0
    let endIndex = -1

    for (const char of str) {
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

export const findStartAndEnd = (text, pattern, color) => {
    let index = 0

    while (true) {
        index = text.indexOf(pattern, index)
        if (index === -1) {
            break
        }
        const endBracketIndex = index + findEndBracket(text.slice(index))
        const relevantText = text.slice(index, endBracketIndex)
        const coloredText = color(relevantText)
        text = text.slice(0, index) + coloredText + text.slice(endBracketIndex)
        index += coloredText.length - relevantText.length
    }

    return text
}