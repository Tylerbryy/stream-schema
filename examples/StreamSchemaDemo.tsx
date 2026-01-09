"use client"

import { useState, useCallback, useRef } from "react"
import { createStreamParser, createLLMParser, type JSONSchema, type ParseResult } from "stream-schema"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Play, RotateCcw, Zap, Shield, Code2, CheckCircle2, AlertCircle, Clock } from "lucide-react"

interface ParseState {
  buffer: string
  displayedChunks: string[]
  partialData: Record<string, unknown>
  completedFields: string[]
  pendingFields: string[]
  errors: string[]
  isComplete: boolean
  isStreaming: boolean
  bytesProcessed: number
}

const DEMO_SCENARIOS = {
  userProfile: {
    name: "User Profile",
    description: "A typical user object from an LLM",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        email: { type: "string", format: "email" },
        interests: { type: "array", items: { type: "string" } },
      },
      required: ["name", "email"],
    } as const satisfies JSONSchema,
    json: `{"name": "Sarah Chen", "age": 28, "email": "sarah@example.com", "interests": ["AI", "hiking", "photography"]}`,
  },
  productReview: {
    name: "Product Review",
    description: "AI-generated product analysis",
    schema: {
      type: "object",
      properties: {
        product: { type: "string" },
        rating: { type: "number", minimum: 1, maximum: 5 },
        pros: { type: "array", items: { type: "string" } },
        cons: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
      required: ["product", "rating", "summary"],
    } as const satisfies JSONSchema,
    json: `{"product": "Wireless Headphones XR-500", "rating": 4.5, "pros": ["Great sound quality", "Comfortable fit", "Long battery life"], "cons": ["Expensive", "No wired option"], "summary": "Excellent headphones for audiophiles willing to invest in quality."}`,
  },
  llmMistakes: {
    name: "LLM Mistakes",
    description: "Common LLM formatting errors",
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        completed: { type: "boolean" },
        priority: { type: "number" },
      },
    } as const satisfies JSONSchema,
    json: `{title: "Fix the bug", "completed": true, "priority": 1,}`,
    isLLMMode: true,
  },
  validationErrors: {
    name: "Validation Errors",
    description: "Schema validation in action",
    schema: {
      type: "object",
      properties: {
        age: { type: "number", minimum: 0, maximum: 120 },
        email: { type: "string", format: "email" },
      },
      required: ["age", "email"],
    } as const satisfies JSONSchema,
    json: `{"age": 150, "email": "not-an-email"}`,
  },
}

type ScenarioKey = keyof typeof DEMO_SCENARIOS

function createStreamChunks(json: string): string[] {
  const chunks: string[] = []
  const chunkSizes = [3, 5, 2, 8, 4, 6, 3, 7, 2, 5, 4, 9, 3, 6, 8, 4, 5, 2, 7, 3]
  let pos = 0
  let sizeIndex = 0

  while (pos < json.length) {
    const size = chunkSizes[sizeIndex % chunkSizes.length]!
    const chunk = json.slice(pos, pos + size)
    chunks.push(chunk)
    pos += size
    sizeIndex++
  }

  return chunks
}

export function StreamSchemaDemo() {
  const [activeScenario, setActiveScenario] = useState<ScenarioKey>("userProfile")
  const [state, setState] = useState<ParseState>({
    buffer: "",
    displayedChunks: [],
    partialData: {},
    completedFields: [],
    pendingFields: [],
    errors: [],
    isComplete: false,
    isStreaming: false,
    bytesProcessed: 0,
  })

  const streamRef = useRef<NodeJS.Timeout | null>(null)
  const parserRef = useRef<ReturnType<typeof createStreamParser> | null>(null)

  const scenario = DEMO_SCENARIOS[activeScenario]

  const startStreaming = useCallback(() => {
    const chunks = createStreamChunks(scenario.json)
    const isLLMMode = "isLLMMode" in scenario && scenario.isLLMMode

    const collectedErrors: string[] = []

    parserRef.current = isLLMMode
      ? createLLMParser(scenario.schema, {
          events: {
            onValidationError: (error) => {
              collectedErrors.push(`${error.path.join(".")}: ${error.message}`)
            },
          },
        })
      : createStreamParser(scenario.schema, {
          events: {
            onValidationError: (error) => {
              collectedErrors.push(`${error.path.join(".")}: ${error.message}`)
            },
          },
        })

    setState({
      buffer: "",
      displayedChunks: [],
      partialData: {},
      completedFields: [],
      pendingFields: [],
      errors: [],
      isComplete: false,
      isStreaming: true,
      bytesProcessed: 0,
    })

    let chunkIndex = 0

    const processNextChunk = () => {
      if (chunkIndex >= chunks.length || !parserRef.current) {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          isComplete: true,
          errors: collectedErrors,
        }))
        return
      }

      const chunk = chunks[chunkIndex]!

      const result: ParseResult<unknown> = parserRef.current.feed(chunk)

      setState((prev) => ({
        ...prev,
        buffer: prev.buffer + chunk,
        displayedChunks: [...prev.displayedChunks, chunk],
        partialData: (result.data as Record<string, unknown>) ?? {},
        completedFields: result.completedFields,
        pendingFields: result.pendingFields,
        bytesProcessed: result.bytesProcessed,
        isComplete: result.complete,
        errors: collectedErrors,
      }))

      chunkIndex++

      if (result.complete) {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
        }))
        return
      }

      streamRef.current = setTimeout(processNextChunk, 80)
    }

    processNextChunk()
  }, [scenario])

  const resetDemo = useCallback(() => {
    if (streamRef.current) {
      clearTimeout(streamRef.current)
    }
    parserRef.current = null
    setState({
      buffer: "",
      displayedChunks: [],
      partialData: {},
      completedFields: [],
      pendingFields: [],
      errors: [],
      isComplete: false,
      isStreaming: false,
      bytesProcessed: 0,
    })
  }, [])

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-sm font-medium mb-4">
          <Zap className="w-4 h-4" />
          stream-schema
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3 text-balance">
          Streaming JSON Parser with Schema Validation
        </h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto text-balance">
          Parse LLM outputs token by token. Get real-time partial results with incremental validation.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <Zap className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Incremental Parsing</h3>
                <p className="text-sm text-muted-foreground">Get partial results instantly as JSON streams in</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Shield className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Schema Validation</h3>
                <p className="text-sm text-muted-foreground">Validate against JSON Schema as data arrives</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Code2 className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">LLM Error Recovery</h3>
                <p className="text-sm text-muted-foreground">Auto-fix trailing commas, unquoted keys, etc.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs
        value={activeScenario}
        onValueChange={(v) => {
          resetDemo()
          setActiveScenario(v as ScenarioKey)
        }}
        className="mb-6"
      >
        <TabsList className="grid grid-cols-4 w-full max-w-2xl mx-auto">
          {Object.entries(DEMO_SCENARIOS).map(([key, s]) => (
            <TabsTrigger key={key} value={key} className="text-xs sm:text-sm">
              {s.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex items-center justify-center gap-4 mb-8">
        <Button
          onClick={startStreaming}
          disabled={state.isStreaming}
          size="lg"
          className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Play className="w-4 h-4" />
          Start Streaming
        </Button>
        <Button onClick={resetDemo} variant="outline" size="lg" className="gap-2 bg-transparent">
          <RotateCcw className="w-4 h-4" />
          Reset
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Streaming Input</CardTitle>
                <CardDescription>{scenario.description}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {state.isStreaming && (
                  <Badge variant="secondary" className="gap-1 animate-pulse">
                    <Clock className="w-3 h-3" />
                    Streaming
                  </Badge>
                )}
                {state.isComplete && (
                  <Badge className="gap-1 bg-emerald-600 text-white">
                    <CheckCircle2 className="w-3 h-3" />
                    Complete
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm min-h-[120px] mb-4 overflow-x-auto">
              {state.displayedChunks.length > 0 ? (
                <span>
                  {state.displayedChunks.map((chunk, i) => (
                    <span
                      key={i}
                      className={i === state.displayedChunks.length - 1 ? "bg-emerald-500/20 text-emerald-700" : ""}
                    >
                      {chunk}
                    </span>
                  ))}
                  {state.isStreaming && <span className="inline-block w-2 h-4 bg-emerald-500 animate-pulse ml-0.5" />}
                </span>
              ) : (
                <span className="text-muted-foreground">Click &quot;Start Streaming&quot; to begin...</span>
              )}
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{state.bytesProcessed} bytes processed</span>
              <span>•</span>
              <span>{state.displayedChunks.length} chunks received</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Parsed Output</CardTitle>
            <CardDescription>Real-time partial results from stream-schema</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="bg-muted/50 rounded-lg p-4 font-mono text-sm min-h-[120px] mb-4">
              {Object.keys(state.partialData).length > 0 ? (
                <pre className="whitespace-pre-wrap">{JSON.stringify(state.partialData, null, 2)}</pre>
              ) : (
                <span className="text-muted-foreground">Waiting for data...</span>
              )}
            </div>

            <div className="space-y-3">
              {state.completedFields.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm text-muted-foreground">Completed:</span>
                  {state.completedFields.slice(0, 8).map((field) => (
                    <Badge key={field} className="gap-1 bg-emerald-600 text-white">
                      <CheckCircle2 className="w-3 h-3" />
                      {field || "(root)"}
                    </Badge>
                  ))}
                  {state.completedFields.length > 8 && (
                    <Badge variant="secondary">+{state.completedFields.length - 8} more</Badge>
                  )}
                </div>
              )}
              {state.pendingFields.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <span className="text-sm text-muted-foreground">Pending:</span>
                  {state.pendingFields.map((field) => (
                    <Badge key={field} variant="secondary" className="gap-1">
                      <Clock className="w-3 h-3 shrink-0" />
                      {field}
                    </Badge>
                  ))}
                </div>
              )}
              {state.errors.length > 0 && (
                <div className="space-y-1">
                  <span className="text-sm text-muted-foreground">Validation Errors:</span>
                  {state.errors.map((error, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 rounded px-2 py-1"
                    >
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      {error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Schema Definition</CardTitle>
          <CardDescription>
            The JSON Schema used for validation
            {"isLLMMode" in scenario && scenario.isLLMMode && (
              <Badge variant="secondary" className="ml-2">
                LLM Mode Enabled
              </Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
            {JSON.stringify(scenario.schema, null, 2)}
          </pre>
        </CardContent>
      </Card>

      <Card className="mt-6 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Usage Example</CardTitle>
          <CardDescription>How to use stream-schema in your code</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="bg-muted/50 rounded-lg p-4 font-mono text-sm overflow-x-auto text-emerald-700">
            {`import { createStreamParser } from 'stream-schema';

const schema = ${JSON.stringify(scenario.schema, null, 2)};

const parser = createStreamParser(schema, {
  events: {
    onPartialObject: (data) => {
      // Update UI with partial data
      renderPartialUI(data);
    },
    onCompleteField: (field, value) => {
      console.log(\`✓ \${field} completed:\`, value);
    },
    onValidationError: (error) => {
      console.warn('Validation:', error);
    }
  }
});

// Feed chunks as they arrive from LLM
for await (const chunk of llmStream) {
  const result = parser.feed(chunk);

  if (result.complete) {
    return result.data; // Fully typed!
  }
}`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}
