import {
  BarChart3, BookOpen, Boxes, Briefcase, Calculator, Dumbbell, Factory, FileText, Handshake, HardDrive, Hotel, Inbox,
  KanbanSquare, Landmark, LayoutDashboard, MapPin, Package, PanelsTopLeft, Plug, QrCode, Receipt, Settings, ShieldCheck,
  ShoppingBag, ShoppingCart, Sparkles, Store, Table, Truck, UserCog, Users, Wrench, Circle,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  BarChart3, BookOpen, Boxes, Briefcase, Calculator, Dumbbell, Factory, FileText, Handshake, HardDrive, Hotel, Inbox,
  KanbanSquare, Landmark, LayoutDashboard, MapPin, Package, PanelsTopLeft, Plug, QrCode, Receipt, Settings, ShieldCheck,
  ShoppingBag, ShoppingCart, Sparkles, Store, Table, Truck, UserCog, Users, Wrench,
};

export function ModuleIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Circle;
  return <Icon className={className} aria-hidden="true" />;
}
