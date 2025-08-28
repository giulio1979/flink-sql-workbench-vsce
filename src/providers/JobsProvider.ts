import * as vscode from 'vscode';
import { FlinkGatewayServiceAdapter } from '../services/FlinkGatewayServiceAdapter';

export interface FlinkJob {
    id: string;
    name: string;
    status: string;
    startTime: string;
    endTime?: string;
    duration?: string;
}

export class JobsProvider implements vscode.TreeDataProvider<JobItem | JobGroupItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<JobItem | JobGroupItem | undefined | null | void> = new vscode.EventEmitter<JobItem | JobGroupItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<JobItem | JobGroupItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private jobs: FlinkJob[] = [];
    private refreshInterval: NodeJS.Timeout | null = null;
    private autoRefresh: boolean = false;

    constructor(
        private readonly gatewayService: FlinkGatewayServiceAdapter,
        private readonly context: vscode.ExtensionContext
    ) {
        // Read auto-refresh setting from configuration
        const config = vscode.workspace.getConfiguration('flinkSqlWorkbench.jobs');
        this.autoRefresh = config.get('autoRefresh', false);
        
        this.refresh();
        if (this.autoRefresh) {
            this.startAutoRefresh();
        }
    }

    refresh(): void {
        console.log('[JobsProvider] Manual refresh triggered');
        this.loadJobs();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: JobItem | JobGroupItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: JobItem | JobGroupItem): Thenable<(JobItem | JobGroupItem)[]> {
        if (!element) {
            // Root level - return jobs grouped by status
            const runningJobs = this.jobs.filter(job => job.status === 'RUNNING');
            const finishedJobs = this.jobs.filter(job => job.status === 'FINISHED');
            const cancelledJobs = this.jobs.filter(job => job.status === 'CANCELED' || job.status === 'CANCELLED');
            const failedJobs = this.jobs.filter(job => job.status === 'FAILED');
            const otherJobs = this.jobs.filter(job => 
                !['RUNNING', 'FINISHED', 'CANCELED', 'CANCELLED', 'FAILED'].includes(job.status)
            );

            const items: (JobItem | JobGroupItem)[] = [];
            
            if (runningJobs.length > 0) {
                items.push(new JobGroupItem('RUNNING', runningJobs.length));
                items.push(...runningJobs.map(job => new JobItem(job)));
            }
            
            if (finishedJobs.length > 0) {
                items.push(new JobGroupItem('FINISHED', finishedJobs.length));
                items.push(...finishedJobs.map(job => new JobItem(job)));
            }
            
            if (cancelledJobs.length > 0) {
                items.push(new JobGroupItem('CANCELLED', cancelledJobs.length));
                items.push(...cancelledJobs.map(job => new JobItem(job)));
            }
            
            if (failedJobs.length > 0) {
                items.push(new JobGroupItem('FAILED', failedJobs.length));
                items.push(...failedJobs.map(job => new JobItem(job)));
            }
            
            if (otherJobs.length > 0) {
                items.push(new JobGroupItem('OTHER', otherJobs.length));
                items.push(...otherJobs.map(job => new JobItem(job)));
            }

            if (items.length === 0) {
                items.push(new JobItem({
                    id: 'no-jobs',
                    name: 'No jobs found',
                    status: 'EMPTY',
                    startTime: ''
                }));
            }

            return Promise.resolve(items);
        }
        return Promise.resolve([]);
    }

    private async loadJobs(): Promise<void> {
        if (!this.gatewayService.isConnected()) {
            console.log('[JobsProvider] Not connected to gateway, skipping job load');
            this.jobs = [];
            return;
        }

        try {
            console.log('[JobsProvider] Executing SHOW JOBS query...');
            const result = await this.gatewayService.executeQuery('SHOW JOBS;');
            
            console.log('[JobsProvider] === RAW JOBS QUERY RESULT ===');
            console.log('[JobsProvider] Full result object:', JSON.stringify(result, null, 2));
            
            if (result && result.results) {
                console.log('[JobsProvider] Results array length:', result.results.length);
                console.log('[JobsProvider] Raw results data:', JSON.stringify(result.results, null, 2));
                
                // Log column structure if available
                if (result.columns) {
                    console.log('[JobsProvider] Columns structure:', JSON.stringify(result.columns, null, 2));
                }
                
                this.jobs = this.parseJobResults(result.results);
                console.log('[JobsProvider] Parsed jobs:', JSON.stringify(this.jobs, null, 2));
            } else {
                console.log('[JobsProvider] No results found in query response');
                this.jobs = [];
            }
        } catch (error) {
            console.error('[JobsProvider] Error loading jobs:', error);
            this.jobs = [];
        }
    }

    private parseJobResults(results: any[]): FlinkJob[] {
        console.log('[JobsProvider] === PARSING JOB RESULTS ===');
        console.log('[JobsProvider] Number of result rows:', results.length);
        
        return results.map((row, index) => {
            console.log(`[JobsProvider] Processing row ${index}:`, JSON.stringify(row, null, 2));
            console.log(`[JobsProvider] Row type: ${typeof row}, isArray: ${Array.isArray(row)}`);
            
            let id, name, status, startTime, endTime, duration;
            
            if (Array.isArray(row)) {
                // Array format: [job_id, job_name, status, start_time, end_time, duration]
                console.log('[JobsProvider] Processing as array format');
                [id, name, status, startTime, endTime, duration] = row;
                console.log('[JobsProvider] Extracted from array:', { id, name, status, startTime, endTime, duration });
            } else if (row && typeof row === 'object' && row.fields && Array.isArray(row.fields)) {
                // Fields array format
                console.log('[JobsProvider] Processing as fields array format');
                [id, name, status, startTime, endTime, duration] = row.fields;
                console.log('[JobsProvider] Extracted from fields:', { id, name, status, startTime, endTime, duration });
            } else if (row && typeof row === 'object') {
                // Object format - try common field names
                console.log('[JobsProvider] Processing as object format');
                console.log('[JobsProvider] Available keys:', Object.keys(row));
                
                id = row.job_id || row.id || row.field_0 || `job-${index}`;
                name = row.job_name || row.name || row.field_1 || 'Unknown Job';
                status = row.status || row.state || row.field_2 || 'UNKNOWN';
                startTime = row.start_time || row.startTime || row.field_3 || '';
                endTime = row.end_time || row.endTime || row.field_4;
                duration = row.duration || row.field_5;
                
                console.log('[JobsProvider] Extracted from object:', { id, name, status, startTime, endTime, duration });
                
                // Log all available fields for debugging
                console.log('[JobsProvider] All object fields:', JSON.stringify(row, null, 2));
            } else {
                // Fallback
                console.log('[JobsProvider] Using fallback processing');
                id = `job-${index}`;
                name = 'Unknown Job';
                status = 'UNKNOWN';
                startTime = '';
            }

            const finalJob = {
                id: String(id),
                name: String(name),
                status: String(status).toUpperCase(),
                startTime: String(startTime),
                endTime: endTime ? String(endTime) : undefined,
                duration: duration ? String(duration) : undefined
            };
            
            console.log(`[JobsProvider] Final parsed job ${index}:`, JSON.stringify(finalJob, null, 2));
            return finalJob;
        }).filter(job => job.id !== 'no-jobs'); // Filter out placeholder items
    }

    async stopJob(jobId: string): Promise<void> {
        try {
            const result = await this.gatewayService.executeQuery(`STOP JOB '${jobId}';`);
            if (result) {
                vscode.window.showInformationMessage(`Job ${jobId} stop command sent`);
                // Refresh after a short delay to see the status change
                setTimeout(() => this.refresh(), 2000);
            } else {
                vscode.window.showErrorMessage(`Failed to stop job ${jobId}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Error stopping job ${jobId}: ${error}`);
        }
    }

    private startAutoRefresh(): void {
        if (this.autoRefresh && !this.refreshInterval) {
            console.log('[JobsProvider] Starting auto-refresh (10 second interval)');
            this.refreshInterval = setInterval(() => {
                if (this.gatewayService.isConnected()) {
                    console.log('[JobsProvider] Auto-refresh timer fired');
                    this.refresh();
                } else {
                    console.log('[JobsProvider] Auto-refresh timer fired but not connected');
                }
            }, 10000); // Refresh every 10 seconds
        }
    }

    private stopAutoRefresh(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    toggleAutoRefresh(): void {
        this.autoRefresh = !this.autoRefresh;
        if (this.autoRefresh) {
            this.startAutoRefresh();
            vscode.window.showInformationMessage('Jobs auto-refresh enabled');
        } else {
            this.stopAutoRefresh();
            vscode.window.showInformationMessage('Jobs auto-refresh disabled');
        }
    }

    dispose(): void {
        this.stopAutoRefresh();
    }
}

export class JobItem extends vscode.TreeItem {
    constructor(
        public readonly job: FlinkJob
    ) {
        super(job.name, vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = this.buildTooltip();
        this.description = this.buildDescription();
        this.contextValue = job.status === 'RUNNING' ? 'runningJob' : 'job';
        this.iconPath = this.getStatusIcon();
    }

    private buildTooltip(): string {
        const lines = [
            `Job ID: ${this.job.id}`,
            `Name: ${this.job.name}`,
            `Status: ${this.job.status}`,
            `Start Time: ${this.job.startTime}`
        ];
        
        if (this.job.endTime) {
            lines.push(`End Time: ${this.job.endTime}`);
        }
        
        if (this.job.duration) {
            lines.push(`Duration: ${this.job.duration}`);
        }
        
        return lines.join('\n');
    }

    private buildDescription(): string {
        return `${this.job.status} | ${this.job.id.substring(0, 8)}...`;
    }

    private getStatusIcon(): vscode.ThemeIcon {
        switch (this.job.status) {
            case 'RUNNING':
                return new vscode.ThemeIcon('play', new vscode.ThemeColor('charts.green'));
            case 'FINISHED':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
            case 'FAILED':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            case 'CANCELED':
            case 'CANCELLED':
                return new vscode.ThemeIcon('stop-circle', new vscode.ThemeColor('charts.orange'));
            case 'EMPTY':
                return new vscode.ThemeIcon('info');
            default:
                return new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow'));
        }
    }
}

export class JobGroupItem extends vscode.TreeItem {
    constructor(
        public readonly status: string,
        public readonly count: number
    ) {
        super(`${status} (${count})`, vscode.TreeItemCollapsibleState.None);
        
        this.tooltip = `${count} jobs with status ${status}`;
        this.contextValue = 'jobGroup';
        this.iconPath = new vscode.ThemeIcon('folder');
        
        // Style as a separator/header
        this.description = '';
        this.resourceUri = vscode.Uri.parse(`job-group:${status}`);
    }
}
