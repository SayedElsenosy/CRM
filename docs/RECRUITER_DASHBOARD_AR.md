# تشغيل لوحة التوظيف الداخلية

اللوحة تعرض الطلبات والمحادثات وصور المستندات، وتسمح بحفظ حالة مراجعة وملاحظات داخلية. حالة المراجعة مستقلة عن حالة محادثة واتساب.

## ١. تفعيل صلاحيات البيانات

افتح **Supabase → SQL Editor → New query** في المشروع `gdapgkwpfprrvmbjsmls`، ثم انسخ محتوى `supabase/migrations/002_recruiter_dashboard.sql` وشغّله مرة واحدة. لا تنفذ ملف `001_initial_schema.sql` مرة ثانية.

## ٢. إنشاء حساب موظف التوظيف

في **Authentication → Users → Add user** أنشئ حسابًا ببريد الموظف وكلمة مرور. لا تستخدم حساب خدمة. انسخ `User UID` للحساب الجديد من قائمة المستخدمين.

في SQL Editor شغّل الاستعلام التالي بعد استبدال المعرف بالـUID الذي نسخته:

```sql
insert into public.recruiter_users (user_id)
values ('PUT_USER_UID_HERE')
on conflict (user_id) do nothing;
```

يمكنك تكرار الخطوة لكل عضو في الفريق. إزالة أحدهم تتم عبر:

```sql
delete from public.recruiter_users where user_id = 'PUT_USER_UID_HERE';
```

## ٣. فتح اللوحة

افتح رابط اللوحة الخاص على Sites. أول مرة سيُطلب **Publishable key** من **Supabase → Project Settings → API Keys**. يجوز استخدام المفتاح القديم `anon` إن لم يكن المفتاح الجديد متاحًا. المفتاح العام فقط؛ لا تدخل `service_role` أو `secret`.

بعد حفظ المفتاح على المتصفح، سجّل بالبريد وكلمة المرور اللذين أنشأتهما في الخطوة السابقة.

الصور في bucket خاص، والروابط الموقعة لها تنتهي بعد دقيقة. اللوحة تعرض آخر ٥٠٠ متقدم وتاريخ أول ٣٠٠ رسالة لكل متقدم؛ أضف صفحات عندما يزيد حجم العمل.

لا تشارك رابط Sites مع موظفين قبل منحهم وصولًا إلى الموقع والحساب في Supabase. على Supabase صلاحيات القراءة والمراجعة محصورة في `recruiter_users`.
