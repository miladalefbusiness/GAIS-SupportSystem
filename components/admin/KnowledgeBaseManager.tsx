'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Cpu,
  Download,
  Edit3,
  Eye,
  FileText,
  FlaskConical,
  FolderKanban,
  HelpCircle,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toPersianDigits } from '@/src/lib/jalali';

export interface KbDepartmentOption {
  id: string;
  nameFa: string;
  slug: string;
}

export interface KbCollectionItem {
  id: string;
  slug: string;
  nameFa: string;
  descriptionFa: string;
  scope: string;
  isActive: boolean;
  departments: Array<{ departmentId: string; nameFa: string }>;
}

export interface KbDocumentItem {
  id: string;
  collectionId: string | null;
  titleFa: string;
  originalFilename: string;
  mimeType: string;
  fileExtension: string;
  byteSize: number;
  scope: string;
  classification?: string;
  status: string;
  ingestionStage?: string;
  validityStatus?: string;
  supersededByDocId?: string | null;
  embeddingModelUsed?: string | null;
  embeddingDimensions?: number | null;
  isEnabled: boolean;
  version: number;
  chunkCount: number;
  errorMessage: string | null;
  extractedTextPreview: string | null;
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
  departments: Array<{ departmentId: string; nameFa: string }>;
}

export interface KbIngestionJobItem {
  id: string;
  documentId: string;
  documentTitleFa: string;
  originalFilename: string;
  jobType: string;
  status: string;
  stage: string;
  targetVersion: number;
  totalChunks: number;
  processedChunks: number;
  embeddingModel: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface KbEmbeddingHealth {
  activeEmbeddingModel: string | null;
  totalIndexedDocs: number;
  totalQas: number;
  mismatchedDocsCount: number;
  unembeddedDocsCount: number;
  mismatchedQasCount: number;
  mismatchedDocumentIds: string[];
  needsReindex: boolean;
}

export interface KbQaItem {
  id: string;
  collectionId: string | null;
  question: string;
  alternativeQuestions: string[];
  officialAnswer: string;
  category: string;
  keywords: string[];
  scope: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  departments: Array<{ departmentId: string; nameFa: string }>;
}

interface RetrievalTestResult {
  matches: Array<{
    sourceType: 'qa' | 'document_chunk';
    sourceId: string;
    title: string;
    content: string;
    score: number;
    rrfScore?: number;
    rerankScore?: number | null;
    lexicalRank?: number | null;
    semanticRank?: number | null;
    matchedBy?: string[];
    scope: string;
    documentVersion?: number | null;
    pageNumber?: number | null;
    sheetName?: string | null;
    sectionTitle?: string | null;
    expandedFromParent?: boolean;
  }>;
  topScore: number;
  conflictDetected: boolean;
  conflictSummaryFa: string | null;
  trace?: {
    strategy: string;
    strategyReasonFa: string;
    queryTransform?: {
      generatedQueries: Array<{ query: string; type?: string; reason: string }>;
      identifiers?: string[];
    };
    lexicalDocHitCount: number;
    lexicalQaHitCount: number;
    semanticDocHitCount: number;
    semanticQaHitCount: number;
    fusedCandidateCount: number;
    rerankMethod: string;
    parentExpandedCount: number;
    latencyMs: number;
  };
}

const SCOPE_LABELS: Record<string, string> = {
  global: 'عمومی (کل سازمان)',
  department: 'اختصاصی دپارتمان',
  restricted: 'محرمانه (خارج از دسترس AI)',
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  public_org: 'عمومی سازمان',
  department: 'اختصاصی دپارتمان',
  internal_restricted: 'محدود / محرمانه',
};

const VALIDITY_LABELS: Record<string, string> = {
  current: 'معتبر',
  superseded: 'جایگزین‌شده (منسوخ)',
  expired: 'منقضی‌شده',
};

const INGESTION_STAGE_LABELS: Record<string, string> = {
  queued: 'در صف',
  validating: 'اعتبارسنجی',
  extracting: 'استخراج متن',
  normalizing: 'نرمال‌سازی',
  chunking: 'قطعه‌بندی',
  embedding: 'تولید بردار',
  indexing: 'ثبت ایندکس',
  completed: 'تکمیل‌شده',
  failed: 'ناموفق',
};

const JOB_TYPE_LABELS: Record<string, string> = {
  ingest: 'بارگذاری و نمایه‌سازی',
  replace: 'جایگزینی نسخه',
  reprocess: 'پردازش مجدد',
  reindex_embeddings: 'بازسازی بردارها',
};

const DOC_STATUS_LABELS: Record<string, string> = {
  indexed: 'نمایه‌سازی‌شده',
  processing: 'در حال پردازش',
  failed: 'خطا در استخراج',
  disabled: 'غیرفعال',
};

const QA_STATUS_LABELS: Record<string, string> = {
  published: 'منتشرشده',
  draft: 'پیش‌نویس',
  disabled: 'غیرفعال',
};

function formatBytesFa(bytes: number): string {
  if (bytes < 1024) return `${toPersianDigits(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(1))} کیلوبایت`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(2))} مگابایت`;
}

export function KnowledgeBaseManager({
  initialCollections,
  initialDocuments,
  initialQaEntries,
  initialJobs = [],
  initialIndexHealth = null,
  departments,
  canManage,
}: {
  initialCollections: KbCollectionItem[];
  initialDocuments: KbDocumentItem[];
  initialQaEntries: KbQaItem[];
  initialJobs?: KbIngestionJobItem[];
  initialIndexHealth?: KbEmbeddingHealth | null;
  departments: KbDepartmentOption[];
  canManage: boolean;
}) {
  const router = useRouter();

  const [collections, setCollections] = useState<KbCollectionItem[]>(initialCollections);
  const [documents, setDocuments] = useState<KbDocumentItem[]>(initialDocuments);
  const [qaEntries, setQaEntries] = useState<KbQaItem[]>(initialQaEntries);
  const [jobs, setJobs] = useState<KbIngestionJobItem[]>(initialJobs);
  const [indexHealth, setIndexHealth] = useState<KbEmbeddingHealth | null>(initialIndexHealth);
  const [runningJobAction, setRunningJobAction] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Upload Document State
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCollectionId, setUploadCollectionId] = useState('');
  const [uploadScope, setUploadScope] = useState<'global' | 'department' | 'restricted'>('department');
  const [uploadClassification, setUploadClassification] = useState<'public_org' | 'department' | 'internal_restricted'>('department');
  const [uploadEnabled, setUploadEnabled] = useState(true);
  const [uploadDeptIds, setUploadDeptIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Edit Document Metadata State
  const [editingDoc, setEditingDoc] = useState<KbDocumentItem | null>(null);
  const [editDocTitle, setEditDocTitle] = useState('');
  const [editDocCollectionId, setEditDocCollectionId] = useState('');
  const [editDocScope, setEditDocScope] = useState<'global' | 'department' | 'restricted'>('department');
  const [editDocClassification, setEditDocClassification] = useState<'public_org' | 'department' | 'internal_restricted'>('department');
  const [editDocValidity, setEditDocValidity] = useState<'current' | 'superseded' | 'expired'>('current');
  const [editDocDeptIds, setEditDocDeptIds] = useState<string[]>([]);
  const [savingDoc, setSavingDoc] = useState(false);

  // Preview Extracted Text
  const [previewDoc, setPreviewDoc] = useState<KbDocumentItem | null>(null);

  // Replace File State
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const [replacingDocId, setReplacingDocId] = useState<string | null>(null);
  const [busyDocId, setBusyDocId] = useState<string | null>(null);

  // Confirm Delete Document / QA
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'document' | 'qa';
    id: string;
    label: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Q&A Modal State
  const [qaDialogOpen, setQaDialogOpen] = useState(false);
  const [editingQaId, setEditingQaId] = useState<string | null>(null);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAltQuestions, setQaAltQuestions] = useState('');
  const [qaOfficialAnswer, setQaOfficialAnswer] = useState('');
  const [qaCategory, setQaCategory] = useState('عمومی');
  const [qaKeywords, setQaKeywords] = useState('');
  const [qaCollectionId, setQaCollectionId] = useState('');
  const [qaScope, setQaScope] = useState<'global' | 'department' | 'restricted'>('department');
  const [qaStatus, setQaStatus] = useState<'draft' | 'published' | 'disabled'>('published');
  const [qaDeptIds, setQaDeptIds] = useState<string[]>([]);
  const [savingQa, setSavingQa] = useState(false);

  // Collection Modal State
  const [colDialogOpen, setColDialogOpen] = useState(false);
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [colSlug, setColSlug] = useState('');
  const [colNameFa, setColNameFa] = useState('');
  const [colDescFa, setColDescFa] = useState('');
  const [colScope, setColScope] = useState<'global' | 'department' | 'restricted'>('department');
  const [colActive, setColActive] = useState(true);
  const [colDeptIds, setColDeptIds] = useState<string[]>([]);
  const [savingCol, setSavingCol] = useState(false);

  // Retrieval Sandbox State
  const [testDeptId, setTestDeptId] = useState(departments[0]?.id || '');
  const [testQuery, setTestQuery] = useState('');
  const [testingRetrieval, setTestingRetrieval] = useState(false);
  const [testResult, setTestResult] = useState<RetrievalTestResult | null>(null);

  const collectionMap = useMemo(
    () => new Map(collections.map((c) => [c.id, c.nameFa])),
    [collections]
  );

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter(
      (d) =>
        d.titleFa.toLowerCase().includes(q) ||
        d.originalFilename.toLowerCase().includes(q)
    );
  }, [documents, searchQuery]);

  const filteredQas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return qaEntries;
    return qaEntries.filter(
      (item) =>
        item.question.toLowerCase().includes(q) ||
        item.officialAnswer.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }, [qaEntries, searchQuery]);

  function toggleInArray(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function refreshAll() {
    try {
      const [colRes, docRes, qaRes, jobRes] = await Promise.all([
        fetch('/api/admin/knowledge/collections'),
        fetch('/api/admin/knowledge/documents'),
        fetch('/api/admin/knowledge/qa'),
        fetch('/api/admin/knowledge/jobs'),
      ]);
      if (colRes.ok) {
        const d = await colRes.json();
        setCollections(d.collections || []);
      }
      if (docRes.ok) {
        const d = await docRes.json();
        setDocuments(d.documents || []);
      }
      if (qaRes.ok) {
        const d = await qaRes.json();
        setQaEntries(d.entries || []);
      }
      if (jobRes.ok) {
        const d = await jobRes.json();
        setJobs(d.jobs || []);
        setIndexHealth(d.indexHealth || null);
      }
      router.refresh();
    } catch {
      toast.error('خطا در همگام‌سازی اطلاعات مخزن دانش.');
    }
  }

  async function handleJobAction(action: 'reindex_all' | 'reindex_mismatched' | 'process_pending') {
    setRunningJobAction(true);
    try {
      const res = await fetch('/api/admin/knowledge/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'عملیات صف پردازش ناموفق بود.');
        return;
      }
      if (action === 'process_pending') {
        toast.success(
          `صف پردازش اجرا شد (${toPersianDigits(data.summary?.succeeded || 0)} موفق).`
        );
      } else {
        toast.success(
          `${toPersianDigits(data.queuedCount || 0)} سند در صف بازسازی ایندکس قرار گرفت.`
        );
      }
      await refreshAll();
    } catch {
      toast.error('خطای ارتباط در مدیریت صف پردازش.');
    } finally {
      setRunningJobAction(false);
    }
  }

  async function handleUploadDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) {
      toast.error('لطفاً یک فایل PDF، DOCX، TXT، Markdown یا XLSX انتخاب کنید.');
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('titleFa', uploadTitle.trim() || uploadFile.name.replace(/\.[^.]+$/, ''));
      if (uploadCollectionId) fd.append('collectionId', uploadCollectionId);
      fd.append('scope', uploadScope);
      fd.append('classification', uploadClassification);
      fd.append('isEnabled', String(uploadEnabled));
      fd.append('departmentIds', JSON.stringify(uploadDeptIds));

      const res = await fetch('/api/admin/knowledge/documents', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'بارگذاری سند ناموفق بود.');
        return;
      }

      toast.success(
        `سند با موفقیت استخراج و در ${toPersianDigits(data.document?.chunkCount || 0)} قطعه نمایه‌سازی شد.`
      );
      setUploadOpen(false);
      setUploadFile(null);
      setUploadTitle('');
      setUploadCollectionId('');
      setUploadDeptIds([]);
      await refreshAll();
    } catch {
      toast.error('خطا در ارتباط با سرور هنگام بارگذاری سند.');
    } finally {
      setUploading(false);
    }
  }

  function openEditDocument(doc: KbDocumentItem) {
    setEditingDoc(doc);
    setEditDocTitle(doc.titleFa);
    setEditDocCollectionId(doc.collectionId || '');
    setEditDocScope(
      doc.scope === 'global' || doc.scope === 'restricted' ? doc.scope : 'department'
    );
    setEditDocClassification(
      doc.classification === 'public_org' || doc.classification === 'internal_restricted'
        ? doc.classification
        : 'department'
    );
    setEditDocValidity(
      doc.validityStatus === 'superseded' || doc.validityStatus === 'expired'
        ? doc.validityStatus
        : 'current'
    );
    setEditDocDeptIds(doc.departments.map((d) => d.departmentId));
  }

  async function handleSaveDocumentEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingDoc) return;
    setSavingDoc(true);
    try {
      const res = await fetch(`/api/admin/knowledge/documents/${editingDoc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleFa: editDocTitle.trim(),
          collectionId: editDocCollectionId || null,
          scope: editDocScope,
          classification: editDocClassification,
          validityStatus: editDocValidity,
          departmentIds: editDocDeptIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'ویرایش سند ناموفق بود.');
        return;
      }
      toast.success('مشخصات سند به‌روزرسانی شد.');
      setEditingDoc(null);
      await refreshAll();
    } catch {
      toast.error('خطا در ذخیره تغییرات سند.');
    } finally {
      setSavingDoc(false);
    }
  }

  async function handleToggleDocumentEnabled(doc: KbDocumentItem) {
    setBusyDocId(doc.id);
    try {
      const res = await fetch(`/api/admin/knowledge/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !doc.isEnabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'تغییر وضعیت سند ناموفق بود.');
        return;
      }
      toast.success(!doc.isEnabled ? 'سند در بازیابی هوش مصنوعی فعال شد.' : 'سند غیرفعال شد.');
      await refreshAll();
    } catch {
      toast.error('خطای شبکه در تغییر وضعیت.');
    } finally {
      setBusyDocId(null);
    }
  }

  async function handleReprocessDocument(docId: string) {
    setBusyDocId(docId);
    try {
      const res = await fetch(`/api/admin/knowledge/documents/${docId}/reprocess`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'پردازش مجدد ناموفق بود.');
        return;
      }
      toast.success(
        `سند مجدداً پردازش شد (${toPersianDigits(data.chunkCount || 0)} قطعه).`
      );
      await refreshAll();
    } catch {
      toast.error('خطا در پردازش مجدد سند.');
    } finally {
      setBusyDocId(null);
    }
  }

  async function handleReplaceFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const targetId = replacingDocId;
    e.target.value = '';
    setReplacingDocId(null);
    if (!file || !targetId) return;

    setBusyDocId(targetId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/admin/knowledge/documents/${targetId}/replace`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'جایگزینی فایل ناموفق بود.');
        return;
      }
      toast.success(
        `نسخه جدید (${toPersianDigits(data.document?.version || 1)}) جایگزین و نمایه‌سازی شد.`
      );
      await refreshAll();
    } catch {
      toast.error('خطای شبکه در جایگزینی فایل.');
    } finally {
      setBusyDocId(null);
    }
  }

  function openNewQaDialog() {
    setEditingQaId(null);
    setQaQuestion('');
    setQaAltQuestions('');
    setQaOfficialAnswer('');
    setQaCategory('عمومی');
    setQaKeywords('');
    setQaCollectionId('');
    setQaScope('department');
    setQaStatus('published');
    setQaDeptIds([]);
    setQaDialogOpen(true);
  }

  function openEditQaDialog(item: KbQaItem) {
    setEditingQaId(item.id);
    setQaQuestion(item.question);
    setQaAltQuestions(item.alternativeQuestions.join('\n'));
    setQaOfficialAnswer(item.officialAnswer);
    setQaCategory(item.category);
    setQaKeywords(item.keywords.join('، '));
    setQaCollectionId(item.collectionId || '');
    setQaScope(
      item.scope === 'global' || item.scope === 'restricted' ? item.scope : 'department'
    );
    setQaStatus(
      item.status === 'draft' || item.status === 'disabled' ? item.status : 'published'
    );
    setQaDeptIds(item.departments.map((d) => d.departmentId));
    setQaDialogOpen(true);
  }

  async function handleSaveQa(e: React.FormEvent) {
    e.preventDefault();
    setSavingQa(true);
    try {
      const payload = {
        collectionId: qaCollectionId || null,
        question: qaQuestion.trim(),
        alternativeQuestions: qaAltQuestions
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        officialAnswer: qaOfficialAnswer.trim(),
        category: qaCategory.trim() || 'عمومی',
        keywords: qaKeywords
          .split(/[،,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        scope: qaScope,
        status: qaStatus,
        departmentIds: qaDeptIds,
      };

      const url = editingQaId
        ? `/api/admin/knowledge/qa/${editingQaId}`
        : '/api/admin/knowledge/qa';
      const method = editingQaId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'ذخیره پرسش‌وپاسخ ناموفق بود.');
        return;
      }

      toast.success(editingQaId ? 'پرسش‌وپاسخ ویرایش شد.' : 'پرسش‌وپاسخ جدید ثبت شد.');
      setQaDialogOpen(false);
      await refreshAll();
    } catch {
      toast.error('خطای ارتباط با سرور هنگام ذخیره پرسش‌وپاسخ.');
    } finally {
      setSavingQa(false);
    }
  }

  function openNewCollectionDialog() {
    setEditingColId(null);
    setColSlug('');
    setColNameFa('');
    setColDescFa('');
    setColScope('department');
    setColActive(true);
    setColDeptIds([]);
    setColDialogOpen(true);
  }

  function openEditCollectionDialog(col: KbCollectionItem) {
    setEditingColId(col.id);
    setColSlug(col.slug);
    setColNameFa(col.nameFa);
    setColDescFa(col.descriptionFa);
    setColScope(
      col.scope === 'global' || col.scope === 'restricted' ? col.scope : 'department'
    );
    setColActive(col.isActive);
    setColDeptIds(col.departments.map((d) => d.departmentId));
    setColDialogOpen(true);
  }

  async function handleSaveCollection(e: React.FormEvent) {
    e.preventDefault();
    setSavingCol(true);
    try {
      const payload = {
        slug: colSlug.trim().toLowerCase(),
        nameFa: colNameFa.trim(),
        descriptionFa: colDescFa.trim(),
        scope: colScope,
        isActive: colActive,
        departmentIds: colDeptIds,
      };

      const url = editingColId
        ? `/api/admin/knowledge/collections/${editingColId}`
        : '/api/admin/knowledge/collections';
      const method = editingColId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'ذخیره مجموعه دانش ناموفق بود.');
        return;
      }
      toast.success(editingColId ? 'مجموعه دانش ویرایش شد.' : 'مجموعه دانش جدید ایجاد شد.');
      setColDialogOpen(false);
      await refreshAll();
    } catch {
      toast.error('خطا در ذخیره مجموعه دانش.');
    } finally {
      setSavingCol(false);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const url =
        confirmDelete.type === 'document'
          ? `/api/admin/knowledge/documents/${confirmDelete.id}`
          : `/api/admin/knowledge/qa/${confirmDelete.id}`;
      const res = await fetch(url, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'حذف انجام نشد.');
        return;
      }
      toast.success('مورد با موفقیت حذف شد.');
      setConfirmDelete(null);
      await refreshAll();
    } catch {
      toast.error('خطای شبکه در حذف مورد.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleRunRetrievalTest(e: React.FormEvent) {
    e.preventDefault();
    if (!testDeptId || testQuery.trim().length < 2) {
      toast.error('دپارتمان و متن پرسش را وارد کنید.');
      return;
    }
    setTestingRetrieval(true);
    try {
      const res = await fetch('/api/admin/knowledge/test-retrieval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentId: testDeptId,
          query: testQuery.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'اجرای آزمون بازیابی ناموفق بود.');
        return;
      }
      setTestResult(data);
    } catch {
      toast.error('خطا در آزمون بازیابی دانش.');
    } finally {
      setTestingRetrieval(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">
            مدیریت مخزن دانش سازمانی
          </h1>
          <p className="text-sm text-slate-600">
            بارگذاری اسناد، تدوین پرسش‌وپاسخ‌های رسمی و تنظیم مرزبندی دسترسی دپارتمان‌ها برای دستیار هوشمند
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 tabular-nums">
          <span>{toPersianDigits(documents.length)} سند</span>
          <span>·</span>
          <span>{toPersianDigits(qaEntries.length)} پرسش‌وپاسخ</span>
          <span>·</span>
          <span>{toPersianDigits(collections.length)} مجموعه</span>
        </div>
      </div>

      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,.docx,.txt,.md,.xlsx"
        className="hidden"
        onChange={handleReplaceFileChange}
      />

      {indexHealth?.needsReindex && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-950">
            <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold">
                عدم تطابق یا نیاز به به‌روزرسانی بردارهای Embedding
              </p>
              <p>
                {toPersianDigits(indexHealth.mismatchedDocsCount)} سند با مدل قدیمی،{' '}
                {toPersianDigits(indexHealth.unembeddedDocsCount)} سند بدون بردار و{' '}
                {toPersianDigits(indexHealth.mismatchedQasCount)} پرسش‌وپاسخ نیازمند همگام‌سازی با مدل{' '}
                <span className="font-[family-name:var(--font-mono)]">
                  {indexHealth.activeEmbeddingModel}
                </span>{' '}
                هستند.
              </p>
            </div>
          </div>
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              disabled={runningJobAction}
              onClick={() => handleJobAction('reindex_mismatched')}
            >
              {runningJobAction ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>بازسازی و همگام‌سازی ایندکس</span>
            </Button>
          )}
        </div>
      )}

      <Tabs defaultValue="documents" className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <TabsList className="w-full sm:w-auto overflow-x-auto">
            <TabsTrigger value="documents" className="gap-1.5">
              <FileText className="h-4 w-4" />
              <span>اسناد ({toPersianDigits(documents.length)})</span>
            </TabsTrigger>
            <TabsTrigger value="qa" className="gap-1.5">
              <HelpCircle className="h-4 w-4" />
              <span>پرسش‌وپاسخ ({toPersianDigits(qaEntries.length)})</span>
            </TabsTrigger>
            <TabsTrigger value="collections" className="gap-1.5">
              <FolderKanban className="h-4 w-4" />
              <span>مجموعه‌ها ({toPersianDigits(collections.length)})</span>
            </TabsTrigger>
            <TabsTrigger value="jobs" className="gap-1.5">
              <Cpu className="h-4 w-4" />
              <span>صف پردازش و ایندکس ({toPersianDigits(jobs.length)})</span>
            </TabsTrigger>
            <TabsTrigger value="sandbox" className="gap-1.5">
              <FlaskConical className="h-4 w-4" />
              <span>آزمون بازیابی</span>
            </TabsTrigger>
          </TabsList>

          <div className="relative w-full sm:w-64">
            <Search className="h-4 w-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جست‌وجو در عنوان یا متن..."
              className="pr-9"
            />
          </div>
        </div>

        {/* DOCUMENTS TAB */}
        <TabsContent value="documents" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500">
              فرمت‌های مجاز: PDF، DOCX، TXT، Markdown و XLSX با بررسی امضای واقعی فایل و قطعه‌بندی ساختارمند تا سقف ۲۵ مگابایت
            </p>
            {canManage && (
              <Button size="sm" onClick={() => setUploadOpen(true)}>
                <Upload className="h-4 w-4" />
                <span>بارگذاری سند جدید</span>
              </Button>
            )}
          </div>

          {filteredDocs.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center space-y-2">
                <BookOpen className="h-8 w-8 text-slate-400 mx-auto" />
                <p className="text-sm font-medium text-slate-900">
                  سندی برای نمایش وجود ندارد
                </p>
                <p className="text-xs text-slate-500">
                  اسناد راهنما یا دستورالعمل‌های رسمی را بارگذاری کنید تا دستیار هوشمند فقط از آن‌ها پاسخ دهد.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredDocs.map((doc) => (
                <Card key={doc.id}>
                  <CardContent className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">
                          {doc.titleFa}
                        </h3>
                        <span className="text-xs font-[family-name:var(--font-mono)] text-slate-500 uppercase">
                          {doc.fileExtension}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            doc.status === 'indexed'
                              ? 'text-emerald-700'
                              : doc.status === 'failed'
                              ? 'text-red-700'
                              : 'text-amber-700'
                          }`}
                        >
                          {DOC_STATUS_LABELS[doc.status] || doc.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="font-[family-name:var(--font-mono)]">
                          {doc.originalFilename}
                        </span>
                        <span>·</span>
                        <span>{formatBytesFa(doc.byteSize)}</span>
                        <span>·</span>
                        <span>نسخه {toPersianDigits(doc.version)}</span>
                        <span>·</span>
                        <span>{toPersianDigits(doc.chunkCount)} قطعه متنی</span>
                        <span>·</span>
                        <span>{SCOPE_LABELS[doc.scope] || doc.scope}</span>
                        {doc.classification && (
                          <>
                            <span>·</span>
                            <span>
                              طبقه‌بندی:{' '}
                              {CLASSIFICATION_LABELS[doc.classification] ||
                                doc.classification}
                            </span>
                          </>
                        )}
                        {doc.validityStatus && (
                          <>
                            <span>·</span>
                            <span
                              className={
                                doc.validityStatus === 'current'
                                  ? 'text-emerald-700'
                                  : 'text-amber-700 font-medium'
                              }
                            >
                              اعتبار:{' '}
                              {VALIDITY_LABELS[doc.validityStatus] ||
                                doc.validityStatus}
                            </span>
                          </>
                        )}
                        {doc.embeddingModelUsed && (
                          <>
                            <span>·</span>
                            <span className="font-[family-name:var(--font-mono)]">
                              {doc.embeddingModelUsed}
                            </span>
                          </>
                        )}
                        {doc.collectionId && collectionMap.has(doc.collectionId) && (
                          <>
                            <span>·</span>
                            <span>مجموعه: {collectionMap.get(doc.collectionId)}</span>
                          </>
                        )}
                      </div>

                      {doc.departments.length > 0 && (
                        <p className="text-xs text-slate-600">
                          دپارتمان‌های مجاز:{' '}
                          {doc.departments.map((d) => d.nameFa).join('، ')}
                        </p>
                      )}

                      {doc.errorMessage && (
                        <p className="text-xs text-red-700 flex items-center gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                          <span>خطا: {doc.errorMessage}</span>
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewDoc(doc)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>پیش‌نمایش متن</span>
                      </Button>

                      <Button asChild size="sm" variant="outline">
                        <a href={`/api/admin/knowledge/documents/${doc.id}/download`}>
                          <Download className="h-3.5 w-3.5" />
                          <span>دانلود</span>
                        </a>
                      </Button>

                      {canManage && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDocument(doc)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>ویرایش</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyDocId === doc.id}
                            onClick={() => handleReprocessDocument(doc.id)}
                          >
                            {busyDocId === doc.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            <span>پردازش مجدد</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyDocId === doc.id}
                            onClick={() => {
                              setReplacingDocId(doc.id);
                              replaceInputRef.current?.click();
                            }}
                          >
                            <Upload className="h-3.5 w-3.5" />
                            <span>جایگزینی فایل</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyDocId === doc.id}
                            onClick={() => handleToggleDocumentEnabled(doc)}
                          >
                            <Power className="h-3.5 w-3.5" />
                            <span>{doc.isEnabled ? 'غیرفعال‌سازی' : 'فعال‌سازی'}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() =>
                              setConfirmDelete({
                                type: 'document',
                                id: doc.id,
                                label: doc.titleFa,
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Q&A TAB */}
        <TabsContent value="qa" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500">
              پاسخ‌های رسمی و تأییدشده همراه با پرسش‌های جایگزین و کلیدواژه‌ها برای تطبیق دقیق
            </p>
            {canManage && (
              <Button size="sm" onClick={openNewQaDialog}>
                <Plus className="h-4 w-4" />
                <span>افزودن پرسش‌وپاسخ</span>
              </Button>
            )}
          </div>

          {filteredQas.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center space-y-2">
                <HelpCircle className="h-8 w-8 text-slate-400 mx-auto" />
                <p className="text-sm font-medium text-slate-900">
                  پرسش‌وپاسخی ثبت نشده است
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredQas.map((qa) => (
                <Card key={qa.id}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-900">
                            {qa.question}
                          </h3>
                          <span
                            className={`text-xs font-medium ${
                              qa.status === 'published'
                                ? 'text-emerald-700'
                                : qa.status === 'draft'
                                ? 'text-amber-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {QA_STATUS_LABELS[qa.status] || qa.status}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span>دسته: {qa.category}</span>
                          <span>·</span>
                          <span>{SCOPE_LABELS[qa.scope] || qa.scope}</span>
                          {qa.departments.length > 0 && (
                            <>
                              <span>·</span>
                              <span>
                                دپارتمان‌ها: {qa.departments.map((d) => d.nameFa).join('، ')}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {canManage && (
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEditQaDialog(qa)}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>ویرایش</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-700 hover:bg-red-50"
                            onClick={() =>
                              setConfirmDelete({
                                type: 'qa',
                                id: qa.id,
                                label: qa.question,
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
                          </Button>
                        </div>
                      )}
                    </div>

                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap rounded-lg bg-slate-50 border border-slate-200 p-3">
                      {qa.officialAnswer}
                    </p>

                    {(qa.alternativeQuestions.length > 0 || qa.keywords.length > 0) && (
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                        {qa.alternativeQuestions.length > 0 && (
                          <span>
                            پرسش‌های جایگزین: {qa.alternativeQuestions.join(' | ')}
                          </span>
                        )}
                        {qa.keywords.length > 0 && (
                          <span>کلیدواژه‌ها: {qa.keywords.join('، ')}</span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* COLLECTIONS TAB */}
        <TabsContent value="collections" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-500">
              دسته‌بندی موضوعی اسناد و تخصیص یکجا به یک یا چند دپارتمان
            </p>
            {canManage && (
              <Button size="sm" onClick={openNewCollectionDialog}>
                <Plus className="h-4 w-4" />
                <span>ایجاد مجموعه جدید</span>
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {collections.map((col) => (
              <Card key={col.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">{col.nameFa}</CardTitle>
                      <CardDescription className="font-[family-name:var(--font-mono)] text-xs mt-0.5">
                        {col.slug} · {SCOPE_LABELS[col.scope] || col.scope}
                      </CardDescription>
                    </div>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openEditCollectionDialog(col)}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>ویرایش</span>
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-xs text-slate-600">
                  {col.descriptionFa && <p>{col.descriptionFa}</p>}
                  <p>
                    وضعیت: {col.isActive ? 'فعال' : 'غیرفعال'} · دپارتمان‌های مجاز:{' '}
                    {col.departments.length > 0
                      ? col.departments.map((d) => d.nameFa).join('، ')
                      : 'فقط بر اساس دامنه عمومی/سند'}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* INGESTION JOBS & INDEX HEALTH TAB */}
        <TabsContent value="jobs" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    صف پردازش پس‌زمینه و سلامت ایندکس برداری
                  </CardTitle>
                  <CardDescription>
                    وضعیت مراحل استخراج، قطعه‌بندی سلسله‌مراتبی و همگام‌سازی مدل Embedding اسناد
                  </CardDescription>
                </div>
                {canManage && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={runningJobAction}
                      onClick={() => handleJobAction('process_pending')}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>اجرای صف معوق</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={runningJobAction}
                      onClick={() => handleJobAction('reindex_all')}
                    >
                      <Cpu className="h-3.5 w-3.5" />
                      <span>بازسازی کامل ایندکس</span>
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {indexHealth && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-500">مدل Embedding فعال</p>
                    <p className="font-[family-name:var(--font-mono)] font-semibold text-slate-900 mt-1">
                      {indexHealth.activeEmbeddingModel || 'تنظیم‌نشده (فقط واژگانی)'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-500">اسناد فعال نمایه‌سازی‌شده</p>
                    <p className="font-semibold text-slate-900 mt-1 tabular-nums">
                      {toPersianDigits(indexHealth.totalIndexedDocs)} سند
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-500">اسناد نیازمند بازسازی مدل</p>
                    <p className="font-semibold text-amber-800 mt-1 tabular-nums">
                      {toPersianDigits(
                        indexHealth.mismatchedDocsCount + indexHealth.unembeddedDocsCount
                      )}{' '}
                      مورد
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-slate-500">پرسش‌وپاسخ‌های ناهمسان</p>
                    <p className="font-semibold text-amber-800 mt-1 tabular-nums">
                      {toPersianDigits(indexHealth.mismatchedQasCount)} مورد
                    </p>
                  </div>
                </div>
              )}

              {jobs.length === 0 ? (
                <p className="text-xs text-slate-500 py-4 text-center">
                  هنوز کاری در صف پردازش اسناد ثبت نشده است.
                </p>
              ) : (
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <div
                      key={job.id}
                      className="rounded-lg border border-slate-200 bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900">
                            {job.documentTitleFa}
                          </span>
                          <span className="text-slate-500">
                            ({JOB_TYPE_LABELS[job.jobType] || job.jobType} · نسخه{' '}
                            {toPersianDigits(job.targetVersion)})
                          </span>
                        </div>
                        <p className="text-slate-500">
                          مرحله: {INGESTION_STAGE_LABELS[job.stage] || job.stage} · قطعات:{' '}
                          {toPersianDigits(job.processedChunks)} از{' '}
                          {toPersianDigits(job.totalChunks)}
                          {job.embeddingModel ? ` · ${job.embeddingModel}` : ''}
                        </p>
                        {job.errorMessage && (
                          <p className="text-red-700">خطا: {job.errorMessage}</p>
                        )}
                      </div>
                      <span
                        className={`font-medium whitespace-nowrap ${
                          job.status === 'completed'
                            ? 'text-emerald-700'
                            : job.status === 'failed'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {job.status === 'completed'
                          ? 'تکمیل‌شده'
                          : job.status === 'failed'
                          ? 'ناموفق'
                          : job.status === 'running'
                          ? 'در حال اجرا'
                          : 'در انتظار'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* RETRIEVAL SANDBOX TAB */}
        <TabsContent value="sandbox" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                آزمایشگر بازیابی و مرزبندی دپارتمان (Retrieval Sandbox)
              </CardTitle>
              <CardDescription>
                بررسی کنید که برای هر دپارتمان کدام قطعات اسناد یا پرسش‌وپاسخ‌ها بازیابی می‌شوند و آیا نشت بین دپارتمان‌ها مسدود است.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleRunRetrievalTest} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="test-dept">دپارتمان هدف</Label>
                    <select
                      id="test-dept"
                      value={testDeptId}
                      onChange={(e) => setTestDeptId(e.target.value)}
                      className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                    >
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.nameFa}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="test-query">پرسش آزمایشی مشتری</Label>
                    <div className="flex gap-2">
                      <Input
                        id="test-query"
                        value={testQuery}
                        onChange={(e) => setTestQuery(e.target.value)}
                        placeholder="مثلاً: تعرفه تمدید سالانه یا زمان بررسی پرونده چقدر است؟"
                      />
                      <Button type="submit" disabled={testingRetrieval}>
                        {testingRetrieval ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FlaskConical className="h-4 w-4" />
                        )}
                        <span>اجرای آزمون</span>
                      </Button>
                    </div>
                  </div>
                </div>
              </form>

              {testResult && (
                <div className="space-y-3 border-t border-slate-200 pt-4">
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    <span>
                      بالاترین امتیاز تطبیق:{' '}
                      <strong className="text-slate-900 tabular-nums">
                        {toPersianDigits(testResult.topScore)}
                      </strong>
                    </span>
                    <span>
                      تعداد منابع مجاز یافت‌شده:{' '}
                      <strong className="text-slate-900 tabular-nums">
                        {toPersianDigits(testResult.matches.length)}
                      </strong>
                    </span>
                    {testResult.trace && (
                      <>
                        <span>
                          راهبرد بازیابی:{' '}
                          <strong className="font-[family-name:var(--font-mono)] text-blue-800">
                            {testResult.trace.strategy}
                          </strong>
                        </span>
                        <span>
                          بازرتبه‌بندی:{' '}
                          <strong className="font-[family-name:var(--font-mono)] text-slate-900">
                            {testResult.trace.rerankMethod}
                          </strong>
                        </span>
                        <span>
                          گسترش والد:{' '}
                          <strong className="text-slate-900 tabular-nums">
                            {toPersianDigits(testResult.trace.parentExpandedCount)}
                          </strong>
                        </span>
                        <span className="tabular-nums">
                          زمان: {toPersianDigits(testResult.trace.latencyMs)} ms
                        </span>
                      </>
                    )}
                    {testResult.conflictDetected && (
                      <span className="text-amber-800 font-medium">
                        هشدار تعارض منابع: {testResult.conflictSummaryFa}
                      </span>
                    )}
                  </div>

                  {testResult.trace?.queryTransform && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs space-y-1.5">
                      <div className="font-medium text-slate-800">
                        توضیح راهبرد: {testResult.trace.strategyReasonFa}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {testResult.trace.queryTransform.generatedQueries.map((gq, idx) => (
                          <span
                            key={`${gq.reason}-${idx}`}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                          >
                            <span className="text-slate-400">[{gq.reason}]</span>
                            <span>{gq.query}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {testResult.matches.length === 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      هیچ منبع مجاز و مرتبطی برای این دپارتمان یافت نشد؛ دستیار هوشمند در این حالت پاسخ قطعی نمی‌سازد و از متن عدم اطمینان استفاده می‌کند.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {testResult.matches.map((m) => (
                        <div
                          key={m.sourceId}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-semibold text-slate-900">
                              [{m.sourceType === 'qa' ? 'پرسش‌وپاسخ' : 'قطعه سند'}] {m.title}
                              {m.documentVersion ? ` · v${toPersianDigits(m.documentVersion)}` : ''}
                            </span>
                            <span className="font-[family-name:var(--font-mono)] text-blue-700 tabular-nums">
                              score: {m.score}
                              {m.lexicalRank ? ` · lex#${m.lexicalRank}` : ''}
                              {m.semanticRank ? ` · vec#${m.semanticRank}` : ''}
                              {m.expandedFromParent ? ' · parent-expanded' : ''} ·{' '}
                              {SCOPE_LABELS[m.scope] || m.scope}
                            </span>
                          </div>
                          {(m.sectionTitle || m.pageNumber || m.sheetName) && (
                            <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                              {m.sectionTitle && <span>بخش: {m.sectionTitle}</span>}
                              {m.pageNumber && <span>صفحه: {toPersianDigits(m.pageNumber)}</span>}
                              {m.sheetName && <span>کاربرگ: {m.sheetName}</span>}
                            </div>
                          )}
                          <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {m.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* UPLOAD DOCUMENT DIALOG */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>بارگذاری سند در مخزن دانش</DialogTitle>
            <DialogDescription>
              فایل‌های PDF (متنی)، DOCX، TXT، Markdown و XLSX به صورت ساختارمند استخراج، قطعه‌بندی سلسله‌مراتبی و نمایه‌سازی می‌شوند.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUploadDocument} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="doc-file">فایل سند</Label>
              <Input
                id="doc-file"
                type="file"
                accept=".pdf,.docx,.txt,.md,.xlsx"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-title">عنوان فارسی سند</Label>
              <Input
                id="doc-title"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="مثلاً: آیین‌نامه ثبت درخواست و پشتیبانی ۱۴۰۵"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="doc-scope">سطح دسترسی</Label>
                <select
                  id="doc-scope"
                  value={uploadScope}
                  onChange={(e) =>
                    setUploadScope(e.target.value as 'global' | 'department' | 'restricted')
                  }
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="department">اختصاصی دپارتمان</option>
                  <option value="global">عمومی (کل سازمان)</option>
                  <option value="restricted">محرمانه (خارج از دسترس AI)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-classification">طبقه‌بندی</Label>
                <select
                  id="doc-classification"
                  value={uploadClassification}
                  onChange={(e) =>
                    setUploadClassification(
                      e.target.value as 'public_org' | 'department' | 'internal_restricted'
                    )
                  }
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="department">اختصاصی دپارتمان</option>
                  <option value="public_org">عمومی سازمان</option>
                  <option value="internal_restricted">محدود / محرمانه</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-col">مجموعه دانش (اختیاری)</Label>
                <select
                  id="doc-col"
                  value={uploadCollectionId}
                  onChange={(e) => setUploadCollectionId(e.target.value)}
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">بدون مجموعه</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameFa}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {uploadScope === 'department' && (
              <div className="space-y-1.5">
                <Label>دپارتمان‌های مجاز</Label>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 max-h-36 overflow-y-auto">
                  {departments.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={uploadDeptIds.includes(d.id)}
                        onChange={() => setUploadDeptIds((prev) => toggleInArray(prev, d.id))}
                      />
                      <span>{d.nameFa}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={uploadEnabled}
                onChange={(e) => setUploadEnabled(e.target.checked)}
              />
              <span>بلافاصله برای بازیابی دستیار هوشمند فعال باشد</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUploadOpen(false)}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={uploading}>
                {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>بارگذاری و نمایه‌سازی</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* EDIT DOCUMENT METADATA DIALOG */}
      <Dialog
        open={Boolean(editingDoc)}
        onOpenChange={(open) => {
          if (!open) setEditingDoc(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ویرایش مشخصات سند دانش</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveDocumentEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-doc-title">عنوان فارسی</Label>
              <Input
                id="edit-doc-title"
                value={editDocTitle}
                onChange={(e) => setEditDocTitle(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-doc-scope">سطح دسترسی</Label>
                <select
                  id="edit-doc-scope"
                  value={editDocScope}
                  onChange={(e) =>
                    setEditDocScope(e.target.value as 'global' | 'department' | 'restricted')
                  }
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="department">اختصاصی دپارتمان</option>
                  <option value="global">عمومی (کل سازمان)</option>
                  <option value="restricted">محرمانه (خارج از دسترس AI)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-doc-col">مجموعه دانش</Label>
                <select
                  id="edit-doc-col"
                  value={editDocCollectionId}
                  onChange={(e) => setEditDocCollectionId(e.target.value)}
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">بدون مجموعه</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameFa}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-doc-class">طبقه‌بندی سند</Label>
                <select
                  id="edit-doc-class"
                  value={editDocClassification}
                  onChange={(e) =>
                    setEditDocClassification(
                      e.target.value as 'public_org' | 'department' | 'internal_restricted'
                    )
                  }
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="department">اختصاصی دپارتمان</option>
                  <option value="public_org">عمومی سازمان</option>
                  <option value="internal_restricted">محدود / محرمانه</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-doc-validity">وضعیت اعتبار سند</Label>
                <select
                  id="edit-doc-validity"
                  value={editDocValidity}
                  onChange={(e) =>
                    setEditDocValidity(
                      e.target.value as 'current' | 'superseded' | 'expired'
                    )
                  }
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="current">معتبر (قابل استناد در AI)</option>
                  <option value="superseded">جایگزین‌شده / منسوخ</option>
                  <option value="expired">منقضی‌شده</option>
                </select>
              </div>
            </div>

            {editDocScope === 'department' && (
              <div className="space-y-1.5">
                <Label>دپارتمان‌های مجاز</Label>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 max-h-36 overflow-y-auto">
                  {departments.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={editDocDeptIds.includes(d.id)}
                        onChange={() =>
                          setEditDocDeptIds((prev) => toggleInArray(prev, d.id))
                        }
                      />
                      <span>{d.nameFa}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingDoc(null)}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={savingDoc}>
                {savingDoc && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>ذخیره تغییرات</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* PREVIEW DOCUMENT EXTRACTED TEXT DIALOG */}
      <Dialog
        open={Boolean(previewDoc)}
        onOpenChange={(open) => {
          if (!open) setPreviewDoc(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{previewDoc?.titleFa}</DialogTitle>
            <DialogDescription>
              پیش‌نمایش متن استخراج‌شده برای نمایه‌سازی (حداکثر ۱۲۰۰ کاراکتر اول)
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
            {previewDoc?.extractedTextPreview || 'متنی استخراج نشده است.'}
          </div>
        </DialogContent>
      </Dialog>

      {/* Q&A CREATE/EDIT DIALOG */}
      <Dialog open={qaDialogOpen} onOpenChange={setQaDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingQaId ? 'ویرایش پرسش‌وپاسخ رسمی' : 'افزودن پرسش‌وپاسخ جدید'}
            </DialogTitle>
            <DialogDescription>
              پاسخ‌های منتشرشده در دپارتمان‌های مجاز اولویت بالایی در بازیابی دستیار هوشمند دارند.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveQa} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="qa-question">پرسش اصلی</Label>
              <Input
                id="qa-question"
                value={qaQuestion}
                onChange={(e) => setQaQuestion(e.target.value)}
                required
                placeholder="مثلاً: مدارک لازم برای ثبت درخواست پشتیبانی مالی چیست؟"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="qa-alts">پرسش‌های جایگزین (هر عبارت در یک خط)</Label>
              <textarea
                id="qa-alts"
                rows={2}
                value={qaAltQuestions}
                onChange={(e) => setQaAltQuestions(e.target.value)}
                placeholder="مثلاً: چه مدارکی برای واحد مالی لازم است؟"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="qa-answer">پاسخ رسمی سازمان</Label>
              <textarea
                id="qa-answer"
                rows={4}
                required
                value={qaOfficialAnswer}
                onChange={(e) => setQaOfficialAnswer(e.target.value)}
                placeholder="پاسخ دقیق، رسمی و کامل که دستیار هوشمند باید به آن استناد کند..."
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qa-category">دسته‌بندی</Label>
                <Input
                  id="qa-category"
                  value={qaCategory}
                  onChange={(e) => setQaCategory(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qa-keywords">کلیدواژه‌ها (با کاما یا ویرگول فارسی)</Label>
                <Input
                  id="qa-keywords"
                  value={qaKeywords}
                  onChange={(e) => setQaKeywords(e.target.value)}
                  placeholder="مثلاً: فاکتور، تسویه، مالی، شماره شبا"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qa-scope">سطح دسترسی</Label>
                <select
                  id="qa-scope"
                  value={qaScope}
                  onChange={(e) =>
                    setQaScope(e.target.value as 'global' | 'department' | 'restricted')
                  }
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="department">اختصاصی دپارتمان</option>
                  <option value="global">عمومی (کل سازمان)</option>
                  <option value="restricted">محرمانه (خارج از AI)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qa-status">وضعیت انتشار</Label>
                <select
                  id="qa-status"
                  value={qaStatus}
                  onChange={(e) =>
                    setQaStatus(e.target.value as 'draft' | 'published' | 'disabled')
                  }
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="published">منتشرشده</option>
                  <option value="draft">پیش‌نویس</option>
                  <option value="disabled">غیرفعال</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qa-col">مجموعه (اختیاری)</Label>
                <select
                  id="qa-col"
                  value={qaCollectionId}
                  onChange={(e) => setQaCollectionId(e.target.value)}
                  className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="">بدون مجموعه</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameFa}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {qaScope === 'department' && (
              <div className="space-y-1.5">
                <Label>دپارتمان‌های مجاز</Label>
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 max-h-36 overflow-y-auto">
                  {departments.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={qaDeptIds.includes(d.id)}
                        onChange={() => setQaDeptIds((prev) => toggleInArray(prev, d.id))}
                      />
                      <span>{d.nameFa}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setQaDialogOpen(false)}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={savingQa}>
                {savingQa && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>{editingQaId ? 'ذخیره ویرایش' : 'ثبت پرسش‌وپاسخ'}</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* COLLECTION CREATE/EDIT DIALOG */}
      <Dialog open={colDialogOpen} onOpenChange={setColDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingColId ? 'ویرایش مجموعه دانش' : 'ایجاد مجموعه دانش جدید'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveCollection} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="col-name">نام فارسی مجموعه</Label>
                <Input
                  id="col-name"
                  value={colNameFa}
                  onChange={(e) => setColNameFa(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="col-slug">شناسه انگلیسی (slug)</Label>
                <Input
                  id="col-slug"
                  dir="ltr"
                  value={colSlug}
                  onChange={(e) => setColSlug(e.target.value)}
                  required
                  placeholder="billing-faq"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="col-desc">توضیحات</Label>
              <Input
                id="col-desc"
                value={colDescFa}
                onChange={(e) => setColDescFa(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="col-scope">سطح دسترسی</Label>
              <select
                id="col-scope"
                value={colScope}
                onChange={(e) =>
                  setColScope(e.target.value as 'global' | 'department' | 'restricted')
                }
                className="w-full h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                <option value="department">اختصاصی دپارتمان</option>
                <option value="global">عمومی (کل سازمان)</option>
                <option value="restricted">محرمانه</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>دپارتمان‌های متصل به مجموعه</Label>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 p-3 max-h-32 overflow-y-auto">
                {departments.map((d) => (
                  <label
                    key={d.id}
                    className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={colDeptIds.includes(d.id)}
                      onChange={() => setColDeptIds((prev) => toggleInArray(prev, d.id))}
                    />
                    <span>{d.nameFa}</span>
                  </label>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={colActive}
                onChange={(e) => setColActive(e.target.checked)}
              />
              <span>مجموعه فعال باشد</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setColDialogOpen(false)}
              >
                انصراف
              </Button>
              <Button type="submit" disabled={savingCol}>
                {savingCol && <Loader2 className="h-4 w-4 animate-spin" />}
                <span>ذخیره</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* CONFIRM DELETE DIALOG */}
      <Dialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>تأیید حذف دائمی</DialogTitle>
            <DialogDescription>
              آیا از حذف «{confirmDelete?.label}» مطمئن هستید؟ تمامی قطعات نمایه‌سازی‌شده و ارجاعات آن از مخزن دانش حذف خواهد شد.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDelete(null)}
            >
              انصراف
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={handleConfirmDelete}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>تأیید و حذف</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
