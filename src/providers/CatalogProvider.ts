import * as vscode from 'vscode';
import { FlinkGatewayServiceAdapter } from '../services/FlinkGatewayServiceAdapter';

export class CatalogProvider implements vscode.TreeDataProvider<CatalogItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CatalogItem | undefined | null | void> = new vscode.EventEmitter<CatalogItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CatalogItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private catalogs: string[] = [];
    private currentCatalog: string | null = null;
    private catalogTables = new Map<string, DatabaseItem[]>();
    private loadingCatalogs = new Set<string>();

    constructor(
        private readonly gatewayService: FlinkGatewayServiceAdapter,
        private readonly context: vscode.ExtensionContext
    ) {
        // Explicit type check to ensure TypeScript recognizes the service interface
        this.gatewayService = gatewayService;
        this.refresh();
    }

    refresh(): void {
        this.loadCatalogs();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CatalogItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CatalogItem): Thenable<CatalogItem[]> {
        if (!element) {
            // Root level - return catalogs
            return Promise.resolve(this.catalogs.map(catalog => 
                new CatalogItem(
                    catalog,
                    catalog === this.currentCatalog ? `${catalog} (current)` : catalog,
                    catalog === this.currentCatalog,
                    vscode.TreeItemCollapsibleState.Collapsed
                )
            ));
        } else if (element.type === 'catalog') {
            // Return databases for this catalog
            return this.getDatabasesForCatalog(element.catalogName);
        } else if (element instanceof DatabaseItem) {
            // Return tables for this database
            return this.getTablesForDatabase(element.catalogName, element.databaseName);
        }
        return Promise.resolve([]);
    }

    private async loadCatalogs(): Promise<void> {
        if (!this.gatewayService.isConnected()) {
            this.catalogs = [];
            this.currentCatalog = null;
            return;
        }

        try {
            // Load catalogs
            const catalogsResult = await this.gatewayService.executeQuery('SHOW CATALOGS;');
            if (catalogsResult && catalogsResult.results) {
                this.catalogs = this.extractCatalogNames(catalogsResult.results);
            }

            // Load current catalog
            const currentResult = await this.gatewayService.executeQuery('SHOW CURRENT CATALOG;');
            if (currentResult && currentResult.results && currentResult.results.length > 0) {
                this.currentCatalog = this.extractFirstValue(currentResult.results[0]);
            }

        } catch (error) {
            console.error('Error loading catalogs:', error);
            this.catalogs = [];
            this.currentCatalog = null;
        }
    }

    private async getDatabasesForCatalog(catalogName: string): Promise<CatalogItem[]> {
        if (this.loadingCatalogs.has(catalogName)) {
            return [];
        }

        if (this.catalogTables.has(catalogName)) {
            return this.catalogTables.get(catalogName) || [];
        }

        this.loadingCatalogs.add(catalogName);

        try {
            // Use the catalog
            await this.gatewayService.executeQuery(`USE CATALOG \`${catalogName}\`;`);
            
            // Get databases
            const databasesResult = await this.gatewayService.executeQuery('SHOW DATABASES;');
            const databases: DatabaseItem[] = [];

            if (databasesResult && databasesResult.results) {
                const databaseNames = this.extractCatalogNames(databasesResult.results);
                for (const dbName of databaseNames) {
                    databases.push(new DatabaseItem(
                        catalogName,
                        dbName,
                        dbName,
                        vscode.TreeItemCollapsibleState.Collapsed
                    ));
                }
            }

            this.catalogTables.set(catalogName, databases);
            return databases;

        } catch (error) {
            console.error(`Error loading databases for catalog ${catalogName}:`, error);
            return [];
        } finally {
            this.loadingCatalogs.delete(catalogName);
        }
    }

    private async getTablesForDatabase(catalogName: string, databaseName: string): Promise<CatalogItem[]> {
        try {
            // Use the catalog and database
            await this.gatewayService.executeQuery(`USE CATALOG \`${catalogName}\`;`);
            await this.gatewayService.executeQuery(`USE \`${databaseName}\`;`);
            
            // Get tables
            const tablesResult = await this.gatewayService.executeQuery('SHOW TABLES;');
            const tables: TableItem[] = [];

            if (tablesResult && tablesResult.results) {
                const tableNames = this.extractCatalogNames(tablesResult.results);
                for (const tableName of tableNames) {
                    tables.push(new TableItem(
                        catalogName,
                        databaseName,
                        tableName,
                        tableName
                    ));
                }
            }

            return tables;

        } catch (error) {
            console.error(`Error loading tables for ${catalogName}.${databaseName}:`, error);
            return [];
        }
    }

    private extractCatalogNames(results: any[]): string[] {
        return results.map(row => this.extractFirstValue(row)).filter(Boolean);
    }

    private extractFirstValue(row: any): string {
        if (Array.isArray(row)) {
            return row[0]; // First column
        } else if (row && typeof row === 'object' && row.fields && Array.isArray(row.fields)) {
            return row.fields[0]; // First field
        } else if (row && typeof row === 'object') {
            // Object format - find first value
            const keys = Object.keys(row);
            if (keys.length > 0) {
                return row[keys[0]];
            }
        }
        return '';
    }

    async setCatalog(catalogName: string): Promise<void> {
        try {
            await this.gatewayService.executeQuery(`USE CATALOG \`${catalogName}\`;`);
            this.currentCatalog = catalogName;
            this.refresh();
            vscode.window.showInformationMessage(`Switched to catalog: ${catalogName}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to switch to catalog: ${catalogName}`);
        }
    }

    async insertTableReference(catalogName: string, databaseName?: string, tableName?: string): Promise<void> {
        let reference = '';
        
        if (tableName) {
            reference = `\`${catalogName}\`.\`${databaseName}\`.\`${tableName}\``;
        } else if (databaseName) {
            reference = `\`${catalogName}\`.\`${databaseName}\``;
        } else {
            reference = `\`${catalogName}\``;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const position = activeEditor.selection.active;
            activeEditor.edit(editBuilder => {
                editBuilder.insert(position, reference);
            });
        } else {
            vscode.env.clipboard.writeText(reference);
            vscode.window.showInformationMessage(`Copied to clipboard: ${reference}`);
        }
    }
}

export class CatalogItem extends vscode.TreeItem {
    constructor(
        public readonly catalogName: string,
        public readonly label: string,
        public readonly isCurrent: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly type: string = 'catalog'
    ) {
        super(label, collapsibleState);
        this.tooltip = `Catalog: ${catalogName}`;
        this.contextValue = 'catalog';
        
        if (isCurrent) {
            this.iconPath = new vscode.ThemeIcon('star-full');
        } else {
            this.iconPath = new vscode.ThemeIcon('database');
        }
    }
}

export class DatabaseItem extends CatalogItem {
    constructor(
        public readonly catalogName: string,
        public readonly databaseName: string,
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(catalogName, label, false, collapsibleState, 'database');
        this.tooltip = `Database: ${catalogName}.${databaseName}`;
        this.contextValue = 'database';
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

export class TableItem extends CatalogItem {
    constructor(
        public readonly catalogName: string,
        public readonly databaseName: string,
        public readonly tableName: string,
        public readonly label: string
    ) {
        super(catalogName, label, false, vscode.TreeItemCollapsibleState.None, 'table');
        this.tooltip = `Table: ${catalogName}.${databaseName}.${tableName}`;
        this.contextValue = 'table';
        this.iconPath = new vscode.ThemeIcon('table');
    }
}
