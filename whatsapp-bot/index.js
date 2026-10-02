require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { createClient } = require('@supabase/supabase-js');

console.log("🔗 رابط قاعدة البيانات المستخدم:", process.env.SUPABASE_URL);

// 1. الاتصال بقاعدة البيانات (Supabase)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// 2. إعداد عميل الواتساب
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', (qr) => {
    console.log('\n📱 امسح الكود ده من تطبيق واتساب (الأجهزة المرتبطة):');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n✅ تم ربط الواتساب بنجاح وجاهز للتشغيل الفوري...');
});

client.on('message', async (msg) => {
    if (msg.from === 'status@broadcast' || msg.isGroupMsg) return;

    const cleanPhone = msg.from.replace('@s.whatsapp.net', '').replace('@lid', '').replace('@c.us', '');
    console.log(`📩 رسالة من ${cleanPhone}: ${msg.body}`);

    try {
        // أ. فحص المتقدم أو إنشاءه مع تتبع رقم الخطوة الحالية (current_step)
        let { data: applicant } = await supabase
            .from('applicants')
            .select('*')
            .eq('phone_number', cleanPhone)
            .maybeSingle();

        if (!applicant) {
            const { data: newApplicant } = await supabase
                .from('applicants')
                .insert([{ phone_number: cleanPhone, status: 'جديد' }])
                .select()
                .maybeSingle();
            applicant = newApplicant;
        }

        // حفظ رسالة العميل في جدول messages (لإظهارها في لوحة التحكم)
        await supabase.from('messages').insert([
            { 
                phone_number: cleanPhone, 
                sender: 'user', 
                sender_type: 'applicant', 
                message_text: msg.body 
            }
        ]);

        // ب. جلب الأسئلة بالترتيب من لوحة التحكم (bot_flow)
        const { data: botFlowSteps } = await supabase
            .from('bot_flow')
            .select('*')
            .order('step_order', { ascending: true });

        let replyText = "";
        
        if (msg.body === '1') {
            replyText = "تفاصيل العمل: شغل للطيارين بدخل أسبوعي من 3500 لـ 5000 جنيه، ومرتب شهري ثابت 6200 جنيه. الإجمالي ممكن يوصل لـ 25 ألف جنيه في الشهر! 💸";
            await supabase.from('applicants').update({ status: 'وقف في النص' }).eq('id', applicant.id);
            
        } else if (msg.body === '2') {
            replyText = "الأوراق المطلوبة للتقديم 📁:\n- صورة البطاقة\n- رخصة القيادة";
            
        } else if (msg.body === '3') {
            replyText = "ممتاز! تقدر تنورنا في مقر الشركة للتقديم.\nمواعيد المقابلات: من 10 صباحاً لـ 4 عصراً.";
            await supabase.from('applicants').update({ status: 'بعت الورق' }).eq('id', applicant.id);
            
        } else {
            // تحديد الخطوة الحالية للمستخدم (لو مش موجودة تبدأ من 0 وهي السؤال الأول)
            let currentStep = applicant.current_step !== undefined && applicant.current_step !== null ? applicant.current_step : 0;

            if (botFlowSteps && botFlowSteps.length > 0) {
                if (currentStep < botFlowSteps.length) {
                    replyText = botFlowSteps[currentStep].question_text;
                    
                    // تحديث الخطوة للمرة القادمة لتنتقل للسؤال التالي تلقائياً
                    await supabase.from('applicants')
                        .update({ current_step: currentStep + 1 })
                        .eq('id', applicant.id);
                } else {
                    replyText = "شكراً لك! تم تسجيل ردودك بنجاح، ومسؤول التوظيف هيراجعها ويتواصل معاك في أقرب وقت.";
                }
            } else {
                replyText = "أهلاً بك في بريدفاست! ابعت رقم 1 لتفاصيل العمل أو 2 للأوراق المطلوبة.";
            }
        }

        // إرسال الرد للعميل على الواتساب
        await msg.reply(replyText);
        console.log("🤖 تم الرد بنجاح وانتقل للخطوة التالية:", replyText);

        // ج. حفظ رد البوت في جدول messages لكي يظهر لايف في لوحة التحكم
        await supabase.from('messages').insert([
            { 
                phone_number: cleanPhone, 
                sender: 'bot', 
                sender_type: 'bot', 
                message_text: replyText 
            }
        ]);

    } catch (error) {
        console.error('❌ خطأ عام في المعالجة:', error.message);
    }
});

client.initialize();