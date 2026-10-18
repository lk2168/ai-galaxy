export type NodeType = 'person' | 'paper' | 'model' | 'org' | 'concept' | 'event' | 'project';

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  year: number;
  /** 0-100，历史影响力。手工节点是社群评估，论文是同年份引用百分位，项目是 star 归一化 */
  weight: number;
  summary?: string;
  tags?: string[];
  sources?: string[];
  layer?: 'skeleton' | 'paper' | 'project' | 'plugin' | 'model';
  downloads?: number;
  likes?: number;
  cluster?: string;
  epoch?: 'foundation' | 'emergence';
  cited?: number;
  stars?: number;
  url?: string;
  authors?: string[];
  topics?: string[];
  category?: string;
  family?: string;
}

export interface GraphLink {
  source: string;
  target: string;
  relation: string;
  strength: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
  meta: {
    generatedAt?: string;
    nodeCount?: number;
    linkCount?: number;
    years?: [number, number];
    papers?: number;
    projects?: number;
    plugins?: number;
    hf?: number;
    skeleton?: number;
  };
}



