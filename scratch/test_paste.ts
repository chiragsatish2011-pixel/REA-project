// Test paste simulation logic

function simulateInput(chunks: string[]): string {
  let input = '';
  let resolved = false;

  for (const chunk of chunks) {
    if (resolved) break;
    let str = chunk;

    // Strip bracketed paste escape sequences
    str = str.replace(/\x1b\[200~/g, '').replace(/\x1b\[201~/g, '');

    // Check for Ctrl+C
    if (str.includes('\u0003')) {
      resolved = true;
      return '';
    }

    // Check if chunk contains newline
    const hasNewline = str.includes('\r') || str.includes('\n');
    const textBeforeNewline = hasNewline ? str.split(/[\r\n]+/)[0] : str;

    for (let i = 0; i < textBeforeNewline.length; i++) {
      const ch = textBeforeNewline[i];
      if (ch === '\b' || ch === '\x7f') {
        if (input.length > 0) input = input.slice(0, -1);
      } else if (ch >= ' ') {
        input += ch;
      }
    }

    if (hasNewline) {
      resolved = true;
      return input.trim();
    }
  }

  return input.trim();
}

// Test 1: Single keystrokes
console.log('Test 1 (individual keystrokes + enter):', 
  simulateInput(['n', 'v', 'a', 'p', 'i', '\r']) === 'nvapi' ? 'PASS' : 'FAIL');

// Test 2: Clipboard paste without newline, then enter
console.log('Test 2 (paste 64-char key, then enter):', 
  simulateInput(['nvapi-ABC1234567890XYZ_FULL_API_KEY_PASTED_ALL_AT_ONCE', '\r\n']) === 'nvapi-ABC1234567890XYZ_FULL_API_KEY_PASTED_ALL_AT_ONCE' ? 'PASS' : 'FAIL');

// Test 3: Clipboard paste WITH trailing newline
console.log('Test 3 (paste with trailing newline):', 
  simulateInput(['nvapi-KEY_WITH_TRAILING_NEWLINE\r\n']) === 'nvapi-KEY_WITH_TRAILING_NEWLINE' ? 'PASS' : 'FAIL');

// Test 4: Bracketed paste with trailing newline
console.log('Test 4 (bracketed paste):', 
  simulateInput(['\x1b[200~nvapi-BRACKETED_PASTE_KEY\x1b[201~\n']) === 'nvapi-BRACKETED_PASTE_KEY' ? 'PASS' : 'FAIL');

// Test 5: Paste then backspace then extra chars then enter
console.log('Test 5 (paste + edit):', 
  simulateInput(['nvapi-abcX', '\b', 'd', '\r']) === 'nvapi-abcd' ? 'PASS' : 'FAIL');
