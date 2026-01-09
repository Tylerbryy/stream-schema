const { createStreamParser, createLLMParser } = require('./dist/index.js');

// ANSI color codes for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Simulate typing effect - yield characters one at a time with delays
async function* simulateLLMStream(text, charDelay = 30) {
  for (const char of text) {
    yield char;
    await sleep(charDelay);
  }
}

// Simulate chunked streaming (more realistic network chunks)
async function* simulateChunkedStream(text, chunkSize = 5, chunkDelay = 100) {
  for (let i = 0; i < text.length; i += chunkSize) {
    yield text.slice(i, i + chunkSize);
    await sleep(chunkDelay);
  }
}

function clearLine() {
  process.stdout.write('\r\x1b[K');
}

function printHeader(title) {
  console.log('\n' + colors.bright + colors.cyan + '═'.repeat(60) + colors.reset);
  console.log(colors.bright + colors.cyan + ' ' + title + colors.reset);
  console.log(colors.bright + colors.cyan + '═'.repeat(60) + colors.reset + '\n');
}

function printSection(title) {
  console.log('\n' + colors.yellow + '▶ ' + title + colors.reset);
  console.log(colors.dim + '─'.repeat(40) + colors.reset);
}

// Demo 1: Basic streaming with character-by-character input
async function demo1() {
  printHeader('Demo 1: Character-by-Character Streaming');

  const schema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
      email: { type: 'string', format: 'email' },
    },
    required: ['name', 'email'],
  };

  const json = '{"name": "Alice Johnson", "age": 28, "email": "alice@example.com"}';

  console.log(colors.dim + 'Schema: Object with name (required), age, email (required)' + colors.reset);
  console.log(colors.dim + 'Input:  ' + json + colors.reset + '\n');

  const parser = createStreamParser(schema, {
    events: {
      onCompleteField: (field, value) => {
        console.log(colors.green + `  ✓ Field "${field}" complete: ${JSON.stringify(value)}` + colors.reset);
      },
    },
  });

  let buffer = '';
  process.stdout.write(colors.blue + 'Streaming: ' + colors.reset);

  for await (const char of simulateLLMStream(json, 25)) {
    buffer += char;
    process.stdout.write(colors.bright + char + colors.reset);

    const result = parser.feed(char);

    if (result.complete) {
      console.log('\n');
      console.log(colors.green + colors.bright + '✓ Parsing complete!' + colors.reset);
      console.log(colors.magenta + 'Final data: ' + colors.reset + JSON.stringify(result.data, null, 2));
    }
  }
}

// Demo 2: Chunked streaming with partial updates
async function demo2() {
  printHeader('Demo 2: Chunked Streaming with Partial Updates');

  const schema = {
    type: 'object',
    properties: {
      user: {
        type: 'object',
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          age: { type: 'number' },
        },
      },
      items: {
        type: 'array',
        items: { type: 'string' },
      },
    },
  };

  const json = '{"user": {"firstName": "Bob", "lastName": "Smith", "age": 35}, "items": ["apple", "banana", "cherry"]}';

  console.log(colors.dim + 'Simulating network chunks of ~15 characters each' + colors.reset);
  console.log(colors.dim + 'Input: ' + json + colors.reset + '\n');

  const parser = createStreamParser(schema);

  let chunkNum = 0;
  for await (const chunk of simulateChunkedStream(json, 15, 200)) {
    chunkNum++;
    const result = parser.feed(chunk);

    console.log(colors.yellow + `Chunk ${chunkNum}: ` + colors.reset + colors.dim + JSON.stringify(chunk) + colors.reset);
    console.log(colors.blue + '  Partial data: ' + colors.reset + JSON.stringify(result.data));
    console.log(colors.dim + '  Completed: [' + result.completedFields.join(', ') + ']' + colors.reset);
    console.log();

    if (result.complete) {
      console.log(colors.green + colors.bright + '✓ Parsing complete!' + colors.reset);
    }
  }
}

// Demo 3: LLM Error Recovery
async function demo3() {
  printHeader('Demo 3: LLM Error Recovery Mode');

  const messyJsonExamples = [
    {
      name: 'Trailing comma',
      json: '{"name": "Charlie", "score": 95,}',
    },
    {
      name: 'Unquoted keys',
      json: '{name: "Diana", age: 30}',
    },
    {
      name: 'Single quotes',
      json: "{'name': 'Eve', 'role': 'admin'}",
    },
  ];

  for (const example of messyJsonExamples) {
    printSection(example.name);
    console.log(colors.dim + 'Input: ' + example.json + colors.reset + '\n');

    // Try with strict parser first
    const strictParser = createStreamParser();
    let strictError = null;
    try {
      strictParser.feed(example.json);
    } catch (e) {
      strictError = e.message;
    }

    if (strictError) {
      console.log(colors.red + '  Strict parser: ✗ ' + strictError + colors.reset);
    }

    // Now with LLM parser
    const llmParser = createLLMParser();
    const result = llmParser.feed(example.json);

    if (result.complete) {
      console.log(colors.green + '  LLM parser:    ✓ ' + JSON.stringify(result.data) + colors.reset);
    }

    await sleep(500);
  }
}

// Demo 4: Real-time validation
async function demo4() {
  printHeader('Demo 4: Real-time Schema Validation');

  const schema = {
    type: 'object',
    properties: {
      username: { type: 'string', minLength: 3 },
      email: { type: 'string', format: 'email' },
      age: { type: 'number', minimum: 0, maximum: 120 },
      role: { type: 'string', enum: ['user', 'admin', 'guest'] },
    },
    required: ['username', 'email'],
  };

  // This JSON has validation errors
  const json = '{"username": "ab", "email": "not-an-email", "age": 150, "role": "superuser"}';

  console.log(colors.dim + 'Schema requires:' + colors.reset);
  console.log(colors.dim + '  - username: string, min 3 chars (required)' + colors.reset);
  console.log(colors.dim + '  - email: valid email format (required)' + colors.reset);
  console.log(colors.dim + '  - age: number 0-120' + colors.reset);
  console.log(colors.dim + '  - role: one of [user, admin, guest]' + colors.reset);
  console.log();
  console.log(colors.dim + 'Input: ' + json + colors.reset + '\n');

  const errors = [];
  const parser = createStreamParser(schema, {
    events: {
      onValidationError: (error) => {
        errors.push(error);
        console.log(colors.red + `  ⚠ Validation error at "${error.path.join('.')}": ${error.message}` + colors.reset);
      },
      onCompleteField: (field, value) => {
        console.log(colors.blue + `  Field "${field}": ${JSON.stringify(value)}` + colors.reset);
      },
    },
  });

  for await (const chunk of simulateChunkedStream(json, 10, 150)) {
    parser.feed(chunk);
  }

  console.log();
  console.log(colors.yellow + `Total validation errors: ${errors.length}` + colors.reset);
}

// Demo 5: Large data streaming simulation
async function demo5() {
  printHeader('Demo 5: Large Data Streaming Performance');

  // Generate a larger JSON
  const items = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    name: `Product ${i + 1}`,
    price: Math.round(Math.random() * 10000) / 100,
    inStock: Math.random() > 0.3,
  }));

  const json = JSON.stringify({ products: items, total: items.length });

  console.log(colors.dim + `JSON size: ${(json.length / 1024).toFixed(2)} KB` + colors.reset);
  console.log(colors.dim + `Contains: 100 product objects` + colors.reset + '\n');

  const parser = createStreamParser();
  const chunkSize = 500;
  const startTime = Date.now();
  let chunksProcessed = 0;
  let firstDataTime = null;

  for (let i = 0; i < json.length; i += chunkSize) {
    const chunk = json.slice(i, i + chunkSize);
    const result = parser.feed(chunk);
    chunksProcessed++;

    if (result.data && !firstDataTime) {
      firstDataTime = Date.now() - startTime;
    }

    // Show progress
    const progress = Math.round((i / json.length) * 100);
    const bar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
    clearLine();
    process.stdout.write(colors.cyan + `  Progress: [${bar}] ${progress}%` + colors.reset);

    await sleep(10); // Small delay for visualization
  }

  const totalTime = Date.now() - startTime;

  console.log('\n');
  console.log(colors.green + '  ✓ Parsing complete!' + colors.reset);
  console.log(colors.magenta + `  Time to first data: ${firstDataTime}ms` + colors.reset);
  console.log(colors.magenta + `  Total parse time: ${totalTime}ms` + colors.reset);
  console.log(colors.magenta + `  Chunks processed: ${chunksProcessed}` + colors.reset);
  console.log(colors.magenta + `  Throughput: ${(json.length / totalTime * 1000 / 1024).toFixed(2)} KB/s` + colors.reset);
}

// Main runner
async function main() {
  console.clear();
  console.log(colors.bright + colors.magenta);
  console.log('  ╔═══════════════════════════════════════════════════════╗');
  console.log('  ║                                                       ║');
  console.log('  ║   🌊  stream-schema Demo                              ║');
  console.log('  ║   Streaming JSON Parser with Schema Validation        ║');
  console.log('  ║                                                       ║');
  console.log('  ╚═══════════════════════════════════════════════════════╝');
  console.log(colors.reset);

  await sleep(1000);

  await demo1();
  await sleep(1500);

  await demo2();
  await sleep(1500);

  await demo3();
  await sleep(1500);

  await demo4();
  await sleep(1500);

  await demo5();

  console.log('\n' + colors.bright + colors.green + '═'.repeat(60) + colors.reset);
  console.log(colors.bright + colors.green + ' Demo Complete! ' + colors.reset);
  console.log(colors.bright + colors.green + '═'.repeat(60) + colors.reset + '\n');
}

main().catch(console.error);
