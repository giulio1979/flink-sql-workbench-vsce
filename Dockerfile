FROM codercom/code-server:latest

# Install a VS Code extension
RUN code-server --install-extension IuliusHutuleac.flink-sql-workbench

# Set default user (optional)
USER 1000
