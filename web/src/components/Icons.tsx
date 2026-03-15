'use client';

import {
  ArrowLeft,
  Bot,
  CircleCheck,
  CircleDollarSign,
  CircleX,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  Flame,
  Eye,
  Link2,
  MessageCircle,
  Paperclip,
  Plus,
  Rocket,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Trophy,
  Undo2,
  Cpu,
  Zap,
} from 'lucide-react';

type IconProps = {
  className?: string;
};

export function ArrowLeftIcon({ className = 'w-5 h-5' }: IconProps) {
  return <ArrowLeft className={className} />;
}

export function AgentIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Bot className={className} />;
}

export function CheckCircleIcon({ className = 'w-5 h-5' }: IconProps) {
  return <CircleCheck className={className} />;
}

export function XCircleIcon({ className = 'w-5 h-5' }: IconProps) {
  return <CircleX className={className} />;
}

export function ClockIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Clock3 className={className} />;
}

export function ExclamationTriangleIcon({ className = 'w-5 h-5' }: IconProps) {
  return <TriangleAlert className={className} />;
}

export function DocumentTextIcon({ className = 'w-5 h-5' }: IconProps) {
  return <FileText className={className} />;
}

export function PaperClipIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Paperclip className={className} />;
}

export function MagnifyingGlassIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Search className={className} />;
}

export function CurrencyDollarIcon({ className = 'w-5 h-5' }: IconProps) {
  return <CircleDollarSign className={className} />;
}

export function RocketLaunchIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Rocket className={className} />;
}

export function BoltIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Zap className={className} />;
}

export function LinkIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Link2 className={className} />;
}

export function ShieldCheckIcon({ className = 'w-5 h-5' }: IconProps) {
  return <ShieldCheck className={className} />;
}

export function FireIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Flame className={className} />;
}

export function ArrowUturnLeftIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Undo2 className={className} />;
}

export function ChatBubbleIcon({ className = 'w-5 h-5' }: IconProps) {
  return <MessageCircle className={className} />;
}

export function PlusIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Plus className={className} />;
}

export function EyeIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Eye className={className} />;
}

export function CpuChipIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Cpu className={className} />;
}

export function TrophyIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Trophy className={className} />;
}

export function ChevronDownIcon({ className = 'w-4 h-4' }: IconProps) {
  return <ChevronDown className={className} />;
}

export function ChevronRightIcon({ className = 'w-4 h-4' }: IconProps) {
  return <ChevronRight className={className} />;
}

export function ClipboardDocumentCheckIcon({ className = 'w-5 h-5' }: IconProps) {
  return <ClipboardCheck className={className} />;
}

export function ScaleIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Scale className={className} />;
}

export function SparklesIcon({ className = 'w-5 h-5' }: IconProps) {
  return <Sparkles className={className} />;
}
