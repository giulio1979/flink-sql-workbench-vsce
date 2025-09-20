import * as vscode from 'vscode';
import { SimpleConnection } from '../services/SimpleConnection';

interface ConnectionItem {
    id: string;
    label: string;
    name: string;
    url: string;
    useProxy: boolean;
    isConnected: boolean;
}

export class ConnectionsProvider implements vscode.TreeDataProvider<ConnectionItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor() {
        SimpleConnection.onConnectionChanged(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    getTreeItem(element: ConnectionItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.description = element.isConnected ? '● Connected' : element.url;
        item.tooltip = `${element.name}\nURL: ${element.url}\nProxy: ${element.useProxy ? 'Yes' : 'No'}`;
        item.contextValue = element.isConnected ? 'connectedGateway' : 'availableGateway';
        item.iconPath = new vscode.ThemeIcon(element.isConnected ? 'plug' : 'circle-outline');
        return item;
    }

    getChildren(): Thenable<ConnectionItem[]> {
        const connections = SimpleConnection.getAvailableConnections();
        const currentName = SimpleConnection.getConnectionName();
        
        const items: ConnectionItem[] = connections.map(conn => ({
            id: conn.id,
            label: conn.name,
            name: conn.name,
            url: conn.url,
            useProxy: conn.useProxy,
            isConnected: currentName === conn.name
        }));

        return Promise.resolve(items);
    }

    async connectToGateway(item: ConnectionItem): Promise<void> {
        await SimpleConnection.connect(item.id, item.name, item.url, item.useProxy);
    }

    async disconnect(): Promise<void> {
        SimpleConnection.disconnect();
        vscode.window.showInformationMessage('Disconnected from gateway');
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}
