import * as vscode from 'vscode';
import { FlinkGatewayServiceAdapter } from '../services/FlinkGatewayServiceAdapter';
import { FlinkJob, BaseTreeItem } from '../types';
import { BaseTreeDataProvider, NotificationService, ConfigurationManager, ErrorHandler } from '../utils/base';
import { createModuleLogger } from '../services/logger';

const log = createModuleLogger('JobsProvider');

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
        try {
            const jobs = await this.gatewayService.getJobs();
            log.info('getJobsFromGateway', `Retrieved ${jobs.length} jobs from gateway`);
            
            // Transform the response to FlinkJob format with guaranteed unique IDs
            const usedIds = new Set<string>();
            let duplicateCounter = 0;
            
            return jobs.map((job: any, index: number) => {
                // Ensure we always have a valid, unique ID
                let jobId = job.jid || job.id || `job-${index}-${Date.now()}`;
                
                // Handle duplicate IDs by adding a suffix
                while (usedIds.has(jobId)) {
                    duplicateCounter++;
                    jobId = `${job.jid || job.id || `job-${index}`}-dup-${duplicateCounter}`;
                }
                usedIds.add(jobId);
                
                return {
                    id: jobId,
                    name: job.name || `Job ${jobId}`,
                    status: job.state || job.status || 'UNKNOWN',
                    startTime: job['start-time'] || job.startTime || 0,
                    endTime: job['end-time'] || job.endTime,
                    duration: job.duration || 0,
                    lastModification: job['last-modification'] || job.lastModification || 0,
                    tasks: job.tasks || {},
                    vertices: job.vertices || [],
                    plan: job.plan || {}
                } as FlinkJob;
            });
        } catch (error: any) {
            log.error('getJobsFromGateway', `Failed to get jobs: ${error.message}`);
            // Return empty array on error to prevent crashes
            return [];
        }
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
        } else if ('jobCount' in element) {
            // This is a group, return the jobs for this group
            const status = element.status;
            const jobsForGroup = this.jobs.filter(job => {
                if (status === 'CANCELLED') {
                    return job.status === 'CANCELED' || job.status === 'CANCELLED';
                } else if (status === 'OTHER') {
                    return !['RUNNING', 'FINISHED', 'CANCELED', 'CANCELLED', 'FAILED'].includes(job.status);
                }
                return job.status === status;
            });
            
            return Promise.resolve(jobsForGroup.map(job => this.createJobItem(job)));
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
                    collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
                });
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
        
        // Ensure unique ID for tree item registration
        const itemId = `job-item-${job.id}`;
        
        // Set contextValue based on job status for menu actions
        let contextValue: string;
        switch (job.status.toLowerCase()) {
            case 'running':
                contextValue = 'runningJob';
                break;
            case 'canceled':
            case 'cancelled':
                contextValue = 'cancelledJob';
                break;
            case 'finished':
                contextValue = 'finishedJob';
                break;
            case 'failed':
                contextValue = 'failedJob';
                break;
            default:
                contextValue = 'job';
                break;
        }
        
        return {
            id: itemId,
            label: job.name || job.id,
            type: 'job',
            job,
            description: `${job.status} • ${duration}`,
            tooltip: `Job: ${job.name || job.id}\nStatus: ${job.status}\nStart: ${job.startTime}\nDuration: ${duration}`,
            contextValue: contextValue,
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
            log.info('stopJob', `Stopping job: ${jobId}`);
            await this.gatewayService.stopJob(jobId);
            
            await NotificationService.showInfo(`Job ${jobId} stop command sent`);
            this.refresh();
        }, `Stopping job ${jobId}`);
    }

    async cancelJob(jobId: string): Promise<void> {
        await ErrorHandler.withErrorHandling(async () => {
            log.info('cancelJob', `Cancelling job: ${jobId}`);
            await this.gatewayService.cancelJob(jobId);
            
            await NotificationService.showInfo(`Job ${jobId} cancel command sent`);
            this.refresh();
        }, `Cancelling job ${jobId}`);
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