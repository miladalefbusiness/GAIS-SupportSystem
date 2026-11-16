import {
  Briefcase,
  Building2,
  FileText,
  Globe,
  GraduationCap,
  Headset,
  Shield,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';

export function DepartmentIcon({
  iconKey,
  className = 'h-5 w-5 text-blue-700',
}: {
  iconKey: string;
  className?: string;
}) {
  switch (iconKey) {
    case 'graduation-cap':
      return <GraduationCap className={className} />;
    case 'users':
      return <Users className={className} />;
    case 'wallet':
      return <Wallet className={className} />;
    case 'wrench':
      return <Wrench className={className} />;
    case 'shield':
      return <Shield className={className} />;
    case 'headset':
      return <Headset className={className} />;
    case 'file-text':
      return <FileText className={className} />;
    case 'briefcase':
      return <Briefcase className={className} />;
    case 'globe':
      return <Globe className={className} />;
    case 'building':
    default:
      return <Building2 className={className} />;
  }
}
