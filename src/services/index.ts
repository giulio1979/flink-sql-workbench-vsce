// New robust services
export * from './logger';

// Export specific services to avoid conflicts
export { FlinkApiService } from './FlinkApiService';
export { SessionManager } from './SessionManager';
export { StatementExecutionEngine } from './StatementExecutionEngine';
export { StatementManager } from './StatementManager';
export { FlinkGatewayServiceAdapter } from './FlinkGatewayServiceAdapter';
export { CredentialService } from './CredentialService';

// Export types with specific names to avoid conflicts
export type { 
    GatewayCredentials as NewGatewayCredentials,
    ConnectionConfig as NewConnectionConfig 
} from './FlinkApiService';

export type { 
    SessionInfo as NewSessionInfo 
} from './SessionManager';

export type { 
    ColumnInfo as NewColumnInfo,
    ExecutionState as NewExecutionState,
    ExecutionResult as NewExecutionResult,
    StatementNotification
} from './StatementExecutionEngine';

export type { 
    GlobalStatementEvent 
} from './StatementManager';

// Re-export shared types for convenience
export type { QueryResult, SessionInfo } from '../types';