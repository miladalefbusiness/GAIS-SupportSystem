import { NextRequest, NextResponse } from 'next/server';
import { extractRequestContext } from '@/src/core/audit/audit.ts';
import { requireAnyPermission, requirePermission } from '@/src/core/auth/guards.ts';
import { logger } from '@/src/core/logging/logger.ts';
import { kbScopeSchema } from '@/src/modules/knowledge/schemas.ts';
import {
  listKnowledgeDocumentsAdmin,
  uploadAndIndexDocument,
} from '@/src/modules/knowledge/service.ts';

export const dynamic = 'force-dynamic';

function mapExtractionErrorFa(code: string): { status: number; message: string } {
  switch (code) {
    case 'EMPTY_FILE':
      return { status: 400, message: 'فایل انتخاب‌شده خالی است.' };
    case 'FILE_TOO_LARGE':
      return { status: 413, message: 'حجم فایل از سقف مجاز (۲۵ مگابایت) بیشتر است.' };
    case 'UNSUPPORTED_FILE_TYPE':
      return { status: 400, message: 'فرمت فایل مجاز نیست. فقط PDF، DOCX، TXT و Markdown مجاز است.' };
    case 'INVALID_FILE_SIGNATURE':
      return { status: 400, message: 'محتوای واقعی فایل با پسوند آن مطابقت ندارد.' };
    case 'EXTRACTED_TEXT_EMPTY':
      return {
        status: 422,
        message:
          'متنی از این سند استخراج نشد (ممکن است فایل اسکن تصویری یا خالی باشد).',
      };
    default:
      return { status: 500, message: 'خطا در پردازش و نمایه‌سازی سند.' };
  }
}

export async function GET() {
  const guard = await requireAnyPermission(['kb:workspace:access', 'kb:entries:manage']);
  if (!guard.ok) return guard.response;

  try {
    const documents = await listKnowledgeDocumentsAdmin();
    return NextResponse.json({ documents });
  } catch (error) {
    logger.error('admin.kb.documents_list_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'خطا در دریافت فهرست اسناد دانش.' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requirePermission('kb:entries:manage');
  if (!guard.ok) return guard.response;

  const { ipAddress, userAgent } = extractRequestContext(req.headers);

  try {
    const formData = await req.formData();
    const fileEntry = formData.get('file');
    if (!(fileEntry instanceof File)) {
      return NextResponse.json(
        { error: 'انتخاب فایل سند الزامی است.' },
        { status: 400 }
      );
    }

    const titleFaRaw = String(formData.get('titleFa') || '').trim();
    const titleFa = titleFaRaw || fileEntry.name.replace(/\.[^.]+$/, '');
    if (titleFa.length < 2) {
      return NextResponse.json(
        { error: 'عنوان فارسی سند باید حداقل ۲ کاراکتر باشد.' },
        { status: 400 }
      );
    }

    const scopeRaw = String(formData.get('scope') || 'department');
    const parsedScope = kbScopeSchema.safeParse(scopeRaw);
    if (!parsedScope.success) {
      return NextResponse.json(
        { error: 'سطح دسترسی (scope) نامعتبر است.' },
        { status: 400 }
      );
    }

    const collectionIdRaw = String(formData.get('collectionId') || '').trim();
    const collectionId = collectionIdRaw.length > 0 ? collectionIdRaw : null;
    const isEnabled = String(formData.get('isEnabled') ?? 'true') !== 'false';

    let departmentIds: string[] = [];
    const deptRaw = formData.get('departmentIds');
    if (typeof deptRaw === 'string' && deptRaw.trim().length > 0) {
      try {
        const parsedDepts = JSON.parse(deptRaw);
        if (Array.isArray(parsedDepts)) {
          departmentIds = parsedDepts.filter((x): x is string => typeof x === 'string');
        }
      } catch {
        return NextResponse.json(
          { error: 'فرمت فهرست دپارتمان‌ها نامعتبر است.' },
          { status: 400 }
        );
      }
    }

    const buffer = Buffer.from(await fileEntry.arrayBuffer());

    const result = await uploadAndIndexDocument({
      filename: fileEntry.name,
      buffer,
      titleFa,
      collectionId,
      scope: parsedScope.data,
      isEnabled,
      departmentIds,
      actorUserId: guard.session.user.id,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ document: result }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'EXTRACTION_FAILED';
    const mapped = mapExtractionErrorFa(code);
    if (mapped.status === 500) {
      logger.error('admin.kb.document_upload_failed', { error: code });
    }
    return NextResponse.json({ error: mapped.message, code }, { status: mapped.status });
  }
}
