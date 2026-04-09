"use client";

import React, { useState } from 'react';
import {
    Plus,
    ChevronLeft,
    CheckCircle2,
    RotateCcw,
    Pause,
    XCircle,
    Construction,
    Lock,
    History,
    Play,
    Settings2,
    AlertCircle,
    Database,
    Terminal,
    Clock,
    Layout,
    Network,
    ShieldCheck,
    Zap,
    GitBranch,
    ArrowRightLeft
} from 'lucide-react';

// --- MOCK DATA & CONFIG ---

const INITIAL_TASKS = [
    {
        id: 'task-1',
        title: 'Auth system',
        status: 'PROGRESS',
        version: 'v2',
        progress: 60,
        nodesCount: 7,
        mode: 'PROJECT',
        currentGate: 'quality-gate',
        policy: {
            replanBudgetInitial: 3,
            replanBudgetRemaining: 1,
            verifyBudgetInitial: 5,
            verifyBudgetRemaining: 4
        },
        history: [
            { id: 1, event: 'replan', from: 'v1', to: 'v2', reason: 'Split implementation for parallelism', time: '2h ago' },
            { id: 2, event: 'node_status', node: 'design', to: 'done', time: '3h ago' }
        ]
    },
    {
        id: 'task-2',
        title: 'Add dark mode',
        status: 'INTAKE',
        version: 'v1',
        progress: 0,
        nodesCount: 0,
        mode: 'SIMPLE',
        blockingReason: 'Analyzing requirements...'
    },
    {
        id: 'task-3',
        title: 'Fix login bug',
        status: 'DONE',
        version: 'v1',
        progress: 100,
        nodesCount: 3,
        mode: 'SIMPLE'
    }
];

// Expanded nodes to include Fork/Join and Conditional types
const AUTH_GRAPH_NODES = [
    { id: 'n1', type: 'work', title: 'Design Auth', status: 'done', x: 300, y: 40, metrics: { latency: '45m', tokens: '12k' } },
    { id: 'f1', type: 'fork', title: 'Fork', status: 'done', x: 300, y: 120 },
    { id: 'n2', type: 'work', title: 'Impl Auth', status: 'done', x: 180, y: 220, metrics: { latency: '1h 20m', tokens: '45k' } },
    { id: 'n3', type: 'work', title: 'Write Tests', status: 'running', x: 420, y: 220, attempts: 2, maxAttempts: 3 },
    { id: 'j1', type: 'join', title: 'Join', status: 'pending', x: 300, y: 320 },
    { id: 'g1', type: 'gate', title: 'Quality Gate', status: 'pending', x: 300, y: 420, required: true, strategy: 'auto' },
    { id: 'g2', type: 'gate', title: 'Handoff Gate', status: 'pending', x: 300, y: 540, required: true, strategy: 'human', isLocked: true },
];

const AUTH_EDGES = [
    { from: 'n1', to: 'f1' },
    { from: 'f1', to: 'n2' },
    { from: 'f1', to: 'n3' },
    { from: 'n2', to: 'j1' },
    { from: 'n3', to: 'j1' },
    { from: 'j1', to: 'g1' },
    { from: 'g1', to: 'g2' },
];

// --- SUB-COMPONENTS ---

const NodeIcon = ({ status, className, size = 16 }: { status: string, className?: string, size?: number }) => {
    switch (status) {
        case 'done':
        case 'passed': return <CheckCircle2 size={size} className={`${className} text-green-500`} />;
        case 'running': return <RotateCcw size={size} className={`${className} text-blue-500 animate-spin`} />;
        case 'failed': return <XCircle size={size} className={`${className} text-red-500`} />;
        case 'pending': return <Pause size={size} className={`${className} text-[var(--app-shell-soft-text)]`} />;
        case 'blocked': return <Construction size={size} className={`${className} text-orange-500`} />;
        default: return null;
    }
};

const BudgetBar = ({ label, current, total, colorClass }: { label: string, current: number, total: number, colorClass: string }) => {
    const percentage = (current / total) * 100;
    return (
        <div className="mb-4">
            <div className="flex justify-between text-[10px] font-bold text-[var(--app-shell-soft-text)] uppercase tracking-wider mb-1">
                <span>{label}</span>
                <span>{current}/{total}</span>
            </div>
            <div className="w-full h-2 bg-[var(--secondary)] rounded-full overflow-hidden border border-[var(--border)]/50">
                <div
                    className={`h-full transition-all duration-700 ease-out ${colorClass}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
};

const TaskCard = ({ task, onClick }: { task: any, onClick: (task: any) => void }) => (
    <div
        onClick={() => onClick(task)}
        className="bg-[var(--card-bg)] border border-[var(--border)] rounded-xl p-4 shadow-sm hover:shadow-lg hover:border-blue-200 transition-all cursor-pointer group"
    >
        <div className="flex justify-between items-start mb-2">
            <h4 className="font-bold text-[var(--foreground)] group-hover:text-blue-600 transition-colors">{task.title}</h4>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase tracking-widest ${task.mode === 'SIMPLE' ? 'bg-[var(--secondary)] text-[var(--muted-foreground)]' : 'bg-blue-100 text-blue-600'}`}>
                {task.mode}
            </span>
        </div>

        <div className="flex items-center gap-2 text-[10px] font-bold text-[var(--app-shell-soft-text)] mb-4">
            <Network size={12} />
            <span>{task.nodesCount} nodes</span>
            <span className="text-[var(--border)]">•</span>
            <span>{task.version}</span>
        </div>

        <div className="mb-4">
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-[10px] font-black text-[var(--muted-foreground)]">{task.progress}%</span>
            </div>
            <div className="w-full h-1.5 bg-[var(--secondary)] rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-1000 ${task.status === 'DONE' ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${task.progress}%` }}
                />
            </div>
        </div>

        {task.currentGate && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-1.5 rounded-lg border border-orange-100">
                <Construction size={14} />
                <span className="truncate uppercase tracking-wider">{task.currentGate}</span>
                {task.isLocked && <Lock size={10} className="ml-auto opacity-50" />}
            </div>
        )}

        {task.status === 'INTAKE' && (
            <div className="flex items-center gap-2 text-[10px] font-bold text-[var(--app-shell-soft-text)] px-2 py-1.5 bg-[var(--secondary)] rounded-lg border border-[var(--border)] italic animate-pulse">
                <Terminal size={12} />
                <span>{task.blockingReason}</span>
            </div>
        )}
    </div>
);

const GraphNode = ({ node, isSelected, onClick }: { node: any, isSelected: boolean, onClick: (node: any) => void }) => {
    const isGate = node.type === 'gate';
    const isControl = ['fork', 'join', 'conditional'].includes(node.type);

    const statusColors: Record<string, string> = {
        done: 'border-green-500 bg-green-50 text-green-700',
        passed: 'border-green-500 bg-green-50 text-green-700',
        running: 'border-blue-500 bg-blue-50 shadow-blue-100 shadow-xl ring-4 ring-blue-50',
        pending: 'border-[var(--border)] bg-[var(--card-bg)] text-[var(--app-shell-soft-text)]',
        failed: 'border-red-500 bg-red-50 text-red-700',
        blocked: 'border-orange-500 bg-orange-50 text-orange-700',
    };

    const getShape = () => {
        if (isGate) return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
        if (isControl) return 'circle(50% at 50% 50%)';
        return 'none';
    };

    return (
        <div
            onClick={(e) => { e.stopPropagation(); onClick(node); }}
            className={`absolute flex flex-col items-center justify-center p-3 border-2 transition-all cursor-pointer z-20 hover:scale-105 active:scale-95 ${isSelected ? 'ring-4 ring-blue-400/30 scale-105 border-blue-600' : statusColors[node.status]}`}
            style={{
                left: node.x,
                top: node.y,
                clipPath: getShape(),
                transform: 'translate(-50%, -50%)',
                width: isControl ? '5rem' : isGate ? '8rem' : '9rem',
                height: isControl ? '5rem' : isGate ? '8rem' : '5rem',
                borderRadius: isControl || isGate ? '0' : '1rem'
            }}
        >
            <div className="flex flex-col items-center justify-center text-center">
                {!isControl && (
                    <span className="text-[9px] font-black uppercase tracking-tighter opacity-50 mb-0.5">{node.type}</span>
                )}
                <span className={`font-bold leading-tight ${isControl ? 'text-[10px]' : 'text-xs'}`}>
                    {node.title}
                </span>
                <NodeIcon status={node.status} className="mt-1.5" size={isControl ? 14 : 18} />
                {node.required && <Lock size={10} className="absolute top-2 right-2 opacity-30" />}
            </div>
        </div>
    );
};

// --- MAIN APPLICATION ---

export default function ExecutionGraphPage() {
    const [view, setView] = useState('board');
    const [selectedTask, setSelectedTask] = useState<any>(null);
    const [selectedNode, setSelectedNode] = useState<any>(null);
    const [tasks, setTasks] = useState(INITIAL_TASKS);
    const [graphVersion, setGraphVersion] = useState(2);

    const openTask = (task: any) => {
        setSelectedTask(task);
        setGraphVersion(parseInt(task.version.replace('v', '')));
        setView('detail');
        setSelectedNode(null);
    };

    const closeTask = () => {
        setView('board');
        setSelectedTask(null);
        setSelectedNode(null);
    };

    const triggerReplan = () => {
        const newVersion = graphVersion + 1;
        setGraphVersion(newVersion);
        const updatedTask = {
            ...selectedTask,
            version: `v${newVersion}`,
            policy: {
                ...selectedTask.policy,
                replanBudgetRemaining: Math.max(0, selectedTask.policy.replanBudgetRemaining - 1)
            },
            history: [
                { id: Date.now(), event: 'replan', from: `v${graphVersion}`, to: `v${newVersion}`, reason: 'Manual scope adjustment', time: 'Just now' },
                ...selectedTask.history
            ]
        };
        setSelectedTask(updatedTask);
        setTasks(prev => prev.map(t => t.id === selectedTask.id ? updatedTask : t));
    };

    const renderBoard = () => (
        <div className="flex flex-col h-screen bg-[var(--secondary)] font-sans text-[var(--foreground)] overflow-hidden">
            <header className="desktop-titlebar flex items-center justify-between px-8 py-5 bg-[var(--card-bg)] border-b border-[var(--border)]">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-2xl shadow-xl shadow-blue-200 transform -rotate-3 hover:rotate-0 transition-transform cursor-pointer">
                        ag
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
                            agx <span className="text-blue-600">v2</span>
                        </h1>
                        <p className="text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-[0.2em]">Execution Graph Engine</p>
                    </div>
                </div>
                <div className="flex gap-4">
                    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--secondary)] rounded-lg text-[var(--muted-foreground)] font-bold text-xs border border-[var(--border)]">
                        <Clock size={14} /> System Time: 21:50
                    </div>
                    <button className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-200 active:scale-95">
                        <Plus size={18} strokeWidth={3} />
                        New Execution
                    </button>
                </div>
            </header>

            <main className="flex-1 overflow-x-auto p-8 bg-[var(--background)]">
                <div className="flex gap-8 min-w-max h-full">
                    {[
                        { id: 'INTAKE', icon: <Terminal size={14} />, label: 'Intake', color: 'slate' },
                        { id: 'PROGRESS', icon: <Zap size={14} />, label: 'Progress', color: 'blue' },
                        { id: 'DONE', icon: <ShieldCheck size={14} />, label: 'Done', color: 'green' }
                    ].map(col => (
                        <div key={col.id} className="w-85 flex flex-col gap-6">
                            <div className="flex items-center justify-between px-2">
                                <div className={`flex items-center gap-2 font-black text-sm uppercase tracking-widest text-${col.color}-500`}>
                                    {col.icon} {col.label}
                                </div>
                                <span className="text-[10px] font-black bg-[var(--card-bg)] border border-[var(--border)] text-[var(--app-shell-soft-text)] px-3 py-1 rounded-full shadow-sm">
                                    {tasks.filter(t => t.status === col.id).length}
                                </span>
                            </div>
                            <div className="flex flex-col gap-4 overflow-y-auto pb-8">
                                {tasks.filter(t => t.status === col.id).map(task => (
                                    <TaskCard key={task.id} task={task} onClick={openTask} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );

    const renderDetail = () => {
        const isProject = selectedTask.mode === 'PROJECT';

        return (
            <div className="flex flex-col h-screen bg-[var(--card-bg)] font-sans text-[var(--foreground)] overflow-hidden">
                <header className="desktop-titlebar flex items-center px-6 py-4 border-b border-[var(--border)] bg-[var(--card-bg)] z-50 shadow-sm">
                    <button
                        onClick={closeTask}
                        className="p-2.5 hover:bg-[var(--item-hover-bg)] rounded-xl transition-colors mr-4 text-[var(--app-shell-soft-text)] hover:text-[var(--foreground)]"
                    >
                        <ChevronLeft size={24} strokeWidth={2.5} />
                    </button>
                    <div className="flex-1">
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-black tracking-tight">{selectedTask.title}</h2>
                            <div className="flex gap-1.5">
                                <span className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-black rounded uppercase tracking-widest">
                                    v{graphVersion}
                                </span>
                                <span className="px-2 py-0.5 bg-[var(--secondary)] text-[var(--muted-foreground)] border border-[var(--border)] text-[9px] font-black rounded uppercase tracking-widest">
                                    {selectedTask.progress}% Complete
                                </span>
                            </div>
                        </div>
                        <div className="flex gap-4 mt-0.5">
                            <p className="text-[10px] text-[var(--app-shell-soft-text)] font-bold uppercase tracking-tight">ID: {selectedTask.id}</p>
                            <p className="text-[10px] text-[var(--app-shell-soft-text)] font-bold uppercase tracking-tight">• Phase: Implementation</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button className="flex items-center gap-2 px-4 py-2 text-[var(--muted-foreground)] hover:text-[var(--foreground)] font-bold text-xs bg-[var(--secondary)] border border-[var(--border)] rounded-lg transition-all active:scale-95">
                            <Settings2 size={16} /> Configure
                        </button>
                        <button
                            onClick={triggerReplan}
                            className="flex items-center gap-2 px-4 py-2 bg-[var(--foreground)] hover:bg-black text-white rounded-lg font-bold text-xs transition-all shadow-md active:scale-95"
                        >
                            <GitBranch size={16} /> Trigger Replan
                        </button>
                        <button className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-black text-xs shadow-lg shadow-blue-200 transition-all active:scale-95">
                            <Play size={16} fill="white" /> RESUME EXECUTION
                        </button>
                    </div>
                </header>

                <div className="flex flex-1 overflow-hidden">
                    <div
                        className="flex-1 flex flex-col relative overflow-hidden bg-[var(--secondary)]"
                        onClick={() => setSelectedNode(null)}
                    >
                        {/* Graph Legend Overlay */}
                        <div className="absolute top-6 left-6 z-10">
                            <div className="bg-[var(--card-bg)] backdrop-blur-md border border-[var(--border)] p-3 rounded-xl shadow-xl">
                                <h3 className="text-[9px] font-black text-[var(--app-shell-soft-text)] uppercase mb-3 px-1 tracking-[0.2em]">Visual Language</h3>
                                <div className="flex flex-col gap-2.5">
                                    <div className="flex items-center gap-3 text-[10px] font-bold text-[var(--muted-foreground)]">
                                        <div className="w-5 h-3 rounded bg-[var(--secondary)] border border-[var(--border)]" /> Work Node
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] font-bold text-[var(--muted-foreground)]">
                                        <div className="w-4 h-4 rotate-45 bg-[var(--secondary)] border border-[var(--border)]" /> Gate Node
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] font-bold text-[var(--muted-foreground)]">
                                        <div className="w-4 h-4 rounded-full bg-[var(--secondary)] border border-[var(--border)]" /> Control Node
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Viewport Actions */}
                        <div className="absolute bottom-6 left-6 z-10 flex gap-2">
                            <button className="p-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg shadow hover:bg-[var(--item-hover-bg)] text-[var(--app-shell-soft-text)]"><Plus size={16} /></button>
                            <button className="p-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg shadow hover:bg-[var(--item-hover-bg)] text-[var(--app-shell-soft-text)]"><ArrowRightLeft size={16} className="rotate-90" /></button>
                            <button className="px-3 py-2 bg-[var(--card-bg)] border border-[var(--border)] rounded-lg shadow hover:bg-[var(--item-hover-bg)] text-[10px] font-black text-[var(--muted-foreground)] uppercase tracking-widest">Fit to Screen</button>
                        </div>

                        {/* The Graph Canvas */}
                        <div className="flex-1 overflow-auto relative p-20 flex items-center justify-center cursor-grab active:cursor-grabbing">
                            {isProject ? (
                                <div className="relative w-[600px] h-[600px] select-none">
                                    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
                                        <defs>
                                            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orientation="auto">
                                                <polygon points="0 0, 10 3.5, 0 7" fill="var(--app-shell-soft-text)" />
                                            </marker>
                                        </defs>
                                        {AUTH_EDGES.map((edge, i) => {
                                            const from = AUTH_GRAPH_NODES.find(n => n.id === edge.from);
                                            const to = AUTH_GRAPH_NODES.find(n => n.id === edge.to);
                                            if (!from || !to) return null;
                                            return (
                                                <line
                                                    key={i}
                                                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                                                    stroke="var(--border)"
                                                    strokeWidth="2.5"
                                                    markerEnd="url(#arrowhead)"
                                                    strokeDasharray={from.type === 'work' && from.status === 'running' ? "5,5" : "none"}
                                                    className={from.status === 'running' ? 'animate-[dash_1s_linear_infinite]' : ''}
                                                />
                                            );
                                        })}
                                    </svg>

                                    {AUTH_GRAPH_NODES.map(node => (
                                        <GraphNode
                                            key={node.id}
                                            node={node}
                                            isSelected={selectedNode?.id === node.id}
                                            onClick={setSelectedNode}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center text-[var(--app-shell-soft-text)] bg-[var(--card-bg)] p-16 rounded-[2.5rem] border-2 border-dashed border-[var(--border)] max-w-md text-center shadow-inner">
                                    <div className="w-20 h-20 bg-[var(--secondary)] rounded-3xl flex items-center justify-center mb-6 border border-[var(--border)] shadow-sm">
                                        <Terminal size={40} className="opacity-30" />
                                    </div>
                                    <h3 className="font-black text-xl text-[var(--secondary-foreground)] mb-3 tracking-tight">Linear Task Logic</h3>
                                    <p className="text-sm text-[var(--app-shell-soft-text)] font-medium leading-relaxed">This task has been classified as SIMPLE. Execution runs through a predefined serial sequence without branching overhead.</p>
                                </div>
                            )}
                        </div>

                        {/* Version Timeline */}
                        <div className="h-28 bg-[var(--card-bg)] border-t border-[var(--border)] px-8 py-4 flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                                <span className="text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-[0.2em]">Execution History Timeline</span>
                                <div className="flex gap-4">
                                    <button className="text-[10px] font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest flex items-center gap-1.5">
                                        <History size={12} /> View Full Logs
                                    </button>
                                </div>
                            </div>
                            <div className="flex items-center relative gap-24 h-full">
                                <div className="absolute top-1/2 left-0 w-full h-0.5 bg-[var(--secondary)] -translate-y-1/2" />

                                {selectedTask.history.slice().reverse().map((ev: any, i: number) => (
                                    <div key={ev.id} className="relative z-10 flex flex-col items-center group cursor-pointer">
                                        <div className={`w-3.5 h-3.5 rounded-full border-2 border-[var(--card-bg)] ring-4 ring-offset-2 transition-all group-hover:scale-125 ${i === selectedTask.history.length - 1 ? 'bg-blue-600 ring-blue-100 scale-110' : 'bg-[var(--app-shell-soft-text)] ring-transparent opacity-60'}`} />
                                        <span className={`text-[10px] font-black mt-2 uppercase tracking-tighter ${i === selectedTask.history.length - 1 ? 'text-blue-600' : 'text-[var(--app-shell-soft-text)]'}`}>
                                            {ev.from ? `${ev.from} → ${ev.to}` : ev.event}
                                        </span>
                                        <span className="text-[8px] font-bold text-[var(--app-shell-soft-text)] whitespace-nowrap">{ev.time}</span>
                                    </div>
                                ))}

                                <div className="ml-auto relative z-10 flex flex-col items-end">
                                    <div className="px-4 py-1.5 bg-[var(--secondary)] border border-[var(--border)] rounded-lg text-[9px] font-black text-[var(--app-shell-soft-text)] italic tracking-widest uppercase shadow-sm">
                                        Next Checkpoint: v{graphVersion + 1}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Dynamic Inspector Sidebar */}
                    <aside className="w-90 border-l border-[var(--border)] p-8 flex flex-col gap-8 overflow-y-auto bg-[var(--card-bg)]">
                        {!selectedNode ? (
                            <>
                                <section>
                                    <h3 className="flex items-center gap-2 text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-widest mb-6">
                                        <AlertCircle size={14} /> Execution Overview
                                    </h3>

                                    <div className="bg-[var(--foreground)] p-5 rounded-2xl text-white shadow-xl shadow-[var(--border)]">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1">Active Worker</p>
                                                <h4 className="text-lg font-black tracking-tight flex items-center gap-2">
                                                    write-tests <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                                                </h4>
                                            </div>
                                            <RotateCcw size={20} className="text-[var(--muted-foreground)] animate-[spin_3s_linear_infinite]" />
                                        </div>
                                        <div className="space-y-3">
                                            <div className="flex justify-between text-[10px] font-bold text-[var(--app-shell-soft-text)] uppercase">
                                                <span>Current Attempt</span>
                                                <span className="text-white">2 / 3</span>
                                            </div>
                                            <div className="flex justify-between text-[10px] font-bold text-[var(--app-shell-soft-text)] uppercase">
                                                <span>Time Elapsed</span>
                                                <span className="text-white font-mono">15m 22s</span>
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section>
                                    <h3 className="flex items-center gap-2 text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-widest mb-6">
                                        <Database size={14} /> Resource Budgets
                                    </h3>
                                    {selectedTask.policy ? (
                                        <div className="space-y-2">
                                            <BudgetBar
                                                label="Replans Remaining"
                                                current={selectedTask.policy.replanBudgetRemaining}
                                                total={selectedTask.policy.replanBudgetInitial}
                                                colorClass="bg-blue-600"
                                            />
                                            <BudgetBar
                                                label="Verify Budget"
                                                current={selectedTask.policy.verifyBudgetRemaining}
                                                total={selectedTask.policy.verifyBudgetInitial}
                                                colorClass="bg-indigo-600"
                                            />
                                        </div>
                                    ) : (
                                        <div className="p-4 bg-[var(--secondary)] rounded-xl border border-[var(--border)] text-[10px] font-bold text-[var(--app-shell-soft-text)] uppercase text-center tracking-widest">
                                            Standard Policy Applied
                                        </div>
                                    )}
                                </section>

                                <section>
                                    <h3 className="flex items-center gap-2 text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-widest mb-6">
                                        <Construction size={14} /> Gate Verification
                                    </h3>
                                    <div className="space-y-5">
                                        <div className="flex items-start gap-4">
                                            <div className="mt-1 flex items-center justify-center w-6 h-6 rounded-full bg-orange-100 text-orange-600 border border-orange-200">
                                                <Pause size={12} strokeWidth={3} />
                                            </div>
                                            <div>
                                                <h5 className="text-xs font-black text-[var(--secondary-foreground)] uppercase tracking-tight">quality-gate</h5>
                                                <p className="text-[10px] text-[var(--app-shell-soft-text)] font-medium leading-relaxed mt-1">Pending: Coverage metrics must meet 80% threshold before proceeding.</p>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-4 opacity-40">
                                            <div className="mt-1 flex items-center justify-center w-6 h-6 rounded-full bg-[var(--secondary)] text-[var(--app-shell-soft-text)] border border-[var(--border)]">
                                                <Lock size={12} strokeWidth={3} />
                                            </div>
                                            <div>
                                                <h5 className="text-xs font-black text-[var(--secondary-foreground)] uppercase tracking-tight">handoff-gate</h5>
                                                <p className="text-[10px] text-[var(--app-shell-soft-text)] font-medium leading-relaxed mt-1">Blocked: Human architecture review required after quality gate pass.</p>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            </>
                        ) : (
                            // Selected Node Inspection View
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <button
                                    onClick={() => setSelectedNode(null)}
                                    className="mb-6 flex items-center gap-1.5 text-[10px] font-black text-blue-600 uppercase tracking-widest hover:gap-2 transition-all"
                                >
                                    <ChevronLeft size={14} strokeWidth={3} /> Back to Overview
                                </button>

                                <div className="flex items-center gap-4 mb-8">
                                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border-2 ${selectedNode.status === 'done' ? 'bg-green-50 border-green-200 text-green-600' : 'bg-blue-50 border-blue-200 text-blue-600'}`}>
                                        {selectedNode.type === 'work' ? <Zap size={24} /> : selectedNode.type === 'gate' ? <ShieldCheck size={24} /> : <GitBranch size={24} />}
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-widest">{selectedNode.type} Node</p>
                                        <h3 className="text-xl font-black tracking-tight">{selectedNode.title}</h3>
                                    </div>
                                </div>

                                <div className="space-y-8">
                                    <section>
                                        <h4 className="text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-widest mb-4">Current Status</h4>
                                        <div className="flex items-center gap-3 px-4 py-3 bg-[var(--secondary)] rounded-xl border border-[var(--border)]">
                                            <NodeIcon status={selectedNode.status} size={20} />
                                            <span className="text-xs font-black uppercase tracking-widest text-[var(--secondary-foreground)]">{selectedNode.status}</span>
                                        </div>
                                    </section>

                                    {selectedNode.type === 'work' && (
                                        <section>
                                            <h4 className="text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-widest mb-4">Performance Metrics</h4>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="p-4 bg-[var(--card-bg)] border border-[var(--border)] rounded-xl">
                                                    <p className="text-[9px] font-bold text-[var(--app-shell-soft-text)] uppercase mb-1">Latency</p>
                                                    <p className="text-sm font-black text-[var(--foreground)]">{selectedNode.metrics?.latency || '32m 14s'}</p>
                                                </div>
                                                <div className="p-4 bg-[var(--card-bg)] border border-[var(--border)] rounded-xl">
                                                    <p className="text-[9px] font-bold text-[var(--app-shell-soft-text)] uppercase mb-1">Compute</p>
                                                    <p className="text-sm font-black text-[var(--foreground)]">{selectedNode.metrics?.tokens || '14.2k tokens'}</p>
                                                </div>
                                            </div>
                                        </section>
                                    )}

                                    {selectedNode.type === 'gate' && (
                                        <section>
                                            <h4 className="text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-widest mb-4">Gate Requirements</h4>
                                            <div className="space-y-3">
                                                {[
                                                    { label: 'Unit Tests', status: 'pass' },
                                                    { label: 'Linting', status: 'pass' },
                                                    { label: 'Type Safety', status: 'pass' },
                                                    { label: 'Coverage (>80%)', status: 'fail' }
                                                ].map((check, i) => (
                                                    <div key={i} className="flex items-center justify-between p-3 bg-[var(--card-bg)] border border-[var(--border)] rounded-xl">
                                                        <span className="text-[11px] font-bold text-[var(--muted-foreground)]">{check.label}</span>
                                                        {check.status === 'pass' ? <CheckCircle2 size={16} className="text-green-500" /> : <AlertCircle size={16} className="text-red-500" />}
                                                    </div>
                                                ))}
                                            </div>
                                            {selectedNode.status === 'pending' && (
                                                <div className="mt-8 grid grid-cols-2 gap-3">
                                                    <button className="py-3 bg-red-50 text-red-600 border border-red-100 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-100 transition-all">Reject</button>
                                                    <button className="py-3 bg-green-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-green-100 hover:bg-green-700 transition-all">Approve Gate</button>
                                                </div>
                                            )}
                                        </section>
                                    )}

                                    <section>
                                        <h4 className="text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-widest mb-4">Node Dependencies</h4>
                                        <div className="flex flex-wrap gap-2">
                                            {AUTH_EDGES.filter(e => e.to === selectedNode.id).map((e, i) => (
                                                <div key={i} className="px-3 py-1.5 bg-[var(--secondary)] text-[var(--muted-foreground)] text-[10px] font-bold rounded-lg border border-[var(--border)]">
                                                    Source: {e.from}
                                                </div>
                                            ))}
                                            {AUTH_EDGES.filter(e => e.to === selectedNode.id).length === 0 && (
                                                <span className="text-[10px] font-bold text-[var(--app-shell-soft-text)] italic uppercase">Graph Start Node</span>
                                            )}
                                        </div>
                                    </section>
                                </div>
                            </div>
                        )}

                        <section className="mt-auto pt-8 border-t border-[var(--border)]">
                            <h3 className="flex items-center gap-2 text-[10px] font-black text-[var(--app-shell-soft-text)] uppercase tracking-widest mb-4">
                                <Layout size={14} /> Global Policy
                            </h3>
                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between text-[10px] font-bold">
                                    <span className="text-[var(--app-shell-soft-text)] uppercase">Concurrency Limit</span>
                                    <span className="text-[var(--secondary-foreground)]">3 WorkNodes</span>
                                </div>
                                <div className="flex justify-between text-[10px] font-bold">
                                    <span className="text-[var(--app-shell-soft-text)] uppercase">Mode</span>
                                    <span className="text-blue-600 uppercase">Project / DAG</span>
                                </div>
                            </div>
                        </section>
                    </aside>
                </div>
            </div>
        );
    };

    return (
        <div className="antialiased min-h-screen">
            <style>{`
        @keyframes dash {
          to { stroke-dashoffset: -10; }
        }
      `}</style>
            {view === 'board' ? renderBoard() : renderDetail()}
        </div>
    );
}
