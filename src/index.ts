#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/index.js";

const server = new McpServer({ name: "se-mcp", version: "1.0.0" });
registerAllTools(server);

await server.connect(new StdioServerTransport());
console.error("SE-MCP server running on stdio");
