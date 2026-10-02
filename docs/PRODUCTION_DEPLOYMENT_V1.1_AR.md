# Production Deployment Checklist v1.1

## قبل الرفع

1. إنشاء مشروع Supabase.
2. تشغيل migrations بالترتيب من 001 إلى 015.
3. إضافة Environment Variables من `.env.example`.
4. إعداد Meta WhatsApp Cloud API.
5. ربط Webhook URL مع Edge Function.

## اختبار التشغيل

- إرسال رسالة WhatsApp تجريبية.
- التأكد من ظهورها في جدول messages.
- التأكد من ظهور المحادثة في CRM.
- اختبار Human Takeover.
- اختبار إرسال رد من الـ CRM.

## ملاحظات

يجب تنفيذ اختبار اتصال حقيقي مع Meta قبل اعتماد النسخة للإنتاج.
