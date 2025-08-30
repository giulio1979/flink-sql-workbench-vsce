#!/bin/bash

# Build the extension
npm install

# Package the extension
npx vsce package

# Publish to VSCode Marketplace
npx vsce publish

# Publish to OpenVSX (for code-server)
npx ovsx publish 
