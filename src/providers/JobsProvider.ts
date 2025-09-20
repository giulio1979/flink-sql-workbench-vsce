import * as vscode from 'vscode';
import { FlinkGatewayServiceAdapter } from '../services/FlinkGatewayServiceAdapter';
import { FlinkJob, BaseTreeItem } from '../types';
import { BaseTreeDataProvider, NotificationService, ConfigurationManager, ErrorHandler } from '../utils/base';

interface JobItem extends BaseTreeItem {
    job: FlinkJob;
}

interface JobGroupItem extends BaseTreeItem {
    jobCount: number;
    status: string;
}

export class JobsProvider extends BaseTreeDataProvider<JobItem | JobGroupItem> {
    private jobs: FlinkJob[] = [];
    private refreshInterval: NodeJS.Timeout | null = null;
    private autoRefresh: boolean = false;

    constructor(
        private readonly gatewayService: FlinkGatewayServiceAdapter,
        context: vscode.ExtensionContext
    ) {
        super(context);
        this.setupAutoRefresh();
        this.refresh();
    }

    protected setupAutoRefresh(): void {
        const config = ConfigurationManager.getJobsConfig();
        this.autoRefresh = config.autoRefresh;
        
        if (this.autoRefresh) {
            this.startAutoRefresh(config.refreshInterval);
        }
    }

    async loadData(): Promise<void> {
        await ErrorHandler.withErrorHandling(async () => {
            if (!this.gatewayService.isConnected()) {
                this.jobs = [];
                return;
            }

            // Get jobs from gateway service (assuming this method exists)
            // For now, using placeholder data
            this.jobs = await this.getJobsFromGateway();
        }, 'Loading jobs data', false);
    }

    private async getJobsFromGateway(): Promise<FlinkJob[]> {
        // Placeholder implementation - replace with actual gateway service call
        // return await this.gatewayService.getJobs();
        return [];
    }

    getTreeItem(element: JobItem | JobGroupItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, element.collapsibleState);
        item.id = element.id;
        item.description = element.description;
        item.tooltip = element.tooltip;
        item.contextValue = element.contextValue;
        item.iconPath = element.iconPath;
        return item;
    }

    getChildren(element?: JobItem | JobGroupItem): Thenable<(JobItem | JobGroupItem)[]> {
        if (!element) {
            // Root level - return jobs grouped by status
            return Promise.resolve(this.createGroupedJobItems());
        }
        return Promise.resolve([]);
    }

    private createGroupedJobItems(): (JobItem | JobGroupItem)[] {
        const runningJobs = this.jobs.filter(job => job.status === 'RUNNING');
        const finishedJobs = this.jobs.filter(job => job.status === 'FINISHED');
        const cancelledJobs = this.jobs.filter(job => job.status === 'CANCELED' || job.status === 'CANCELLED');
        const failedJobs = this.jobs.filter(job => job.status === 'FAILED');
        const otherJobs = this.jobs.filter(job => 
            !['RUNNING', 'FINISHED', 'CANCELED', 'CANCELLED', 'FAILED'].includes(job.status)
        );

        const items: (JobItem | JobGroupItem)[] = [];
        
        const addJobGroup = (status: string, jobs: FlinkJob[], icon: string) => {
            if (jobs.length > 0) {
                // Add group header
                items.push({
                    id: `group-${status.toLowerCase()}`,
                    label: status,
                    type: 'group',
                    status,
                    jobCount: jobs.length,
                    description: `${jobs.length} job${jobs.length === 1 ? '' : 's'}`,
                    contextValue: 'jobGroup',
                    iconPath: new vscode.ThemeIcon(icon),
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                });
                
                // Add individual jobs
                items.push(...jobs.map(job => this.createJobItem(job)));
            }
        };

        addJobGroup('RUNNING', runningJobs, 'play');
        addJobGroup('FINISHED', finishedJobs, 'check');
        addJobGroup('CANCELLED', cancelledJobs, 'stop');
        addJobGroup('FAILED', failedJobs, 'error');
        addJobGroup('OTHER', otherJobs, 'question');

        if (items.length === 0) {
            items.push({
                id: 'no-jobs',
                label: 'No jobs found',
                type: 'job',
                job: {
                    id: 'no-jobs',
                    name: 'No jobs found',
                    status: 'FINISHED',
                    startTime: ''
                },
                contextValue: 'noJobs',
                iconPath: new vscode.ThemeIcon('info'),
                collapsibleState: vscode.TreeItemCollapsibleState.None
            });
        }

        return items;
    }

    private createJobItem(job: FlinkJob): JobItem {
        const statusIcon = this.getStatusIcon(job.status);
        const duration = job.duration || 'Unknown';
        
        return {
            id: job.id,
            label: job.name || job.id,
            type: 'job',
            job,
            description: `${job.status} • ${duration}`,
            tooltip: `Job: ${job.name || job.id}\nStatus: ${job.status}\nStart: ${job.startTime}\nDuration: ${duration}`,
            contextValue: `job-${job.status.toLowerCase()}`,
            iconPath: new vscode.ThemeIcon(statusIcon),
            collapsibleState: vscode.TreeItemCollapsibleState.None
        };
    }

    private getStatusIcon(status: string): string {
        switch (status) {
            case 'RUNNING': return 'play';
            case 'FINISHED': return 'check';
            case 'CANCELED':
            case 'CANCELLED': return 'stop';
            case 'FAILED': return 'error';
            default: return 'question';
        }
    }

    async stopJob(jobId: string): Promise<void> {
        await ErrorHandler.withErrorHandling(async () => {
            // Placeholder implementation
            // await this.gatewayService.stopJob(jobId);
            
            await NotificationService.showInfo(`Job ${jobId} stop command sent`);
            this.refresh();
        }, `Stopping job ${jobId}`);
    }

    async toggleAutoRefresh(): Promise<void> {
        this.autoRefresh = !this.autoRefresh;
        
        if (this.autoRefresh) {
            this.startAutoRefresh();
            await NotificationService.showInfo('Jobs auto-refresh enabled');
        } else {
            this.stopAutoRefresh();
            await NotificationService.showInfo('Jobs auto-refresh disabled');
        }
    }

    private startAutoRefresh(interval: number = 10000): void {
        this.stopAutoRefresh();
        this.refreshInterval = setInterval(() => {
            this.refresh();
        }, interval);
    }

    private stopAutoRefresh(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    dispose(): void {
        this.stopAutoRefresh();
        super.dispose();
    }
}