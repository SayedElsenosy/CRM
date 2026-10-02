import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { Users, LayoutDashboard, MessageCircle, MapPin, Search, FileText, CheckCircle, Clock, Inbox, Plus, Trash2, HelpCircle, ArrowUp, ArrowDown } from 'lucide-react'

export default function App() {
  const [activeTab, setActiveTab] = useState('overview')
  const [applicants, setApplicants] = useState([])
  const [areas, setAreas] = useState([])
  const [botFlow, setBotFlow] = useState([])
  
  // إدارة الواتساب
  const [linkedPhone, setLinkedPhone] = useState('+201095100664')

  // المناطق
  const [showAddAreaModal, setShowAddAreaModal] = useState(false)
  const [newAreaName, setNewAreaName] = useState('')
  const [newAreaDetails, setNewAreaDetails] = useState('')

  // أسئلة البوت
  const [newQuestionText, setNewQuestionText] = useState('')
  const [newKeyToSave, setNewKeyToSave] = useState('')
  const [isAreaQuestion, setIsAreaQuestion] = useState(false)
  const [selectedAreaId, setSelectedAreaId] = useState('')
  const [editingId, setEditingId] = useState(null)

  // تفاصيل المتقدم والشات اللايف
  const [selectedApplicant, setSelectedApplicant] = useState(null)
  const [liveMessages, setLiveMessages] = useState([])
  const [searchQuery, setSearchQuery] = useState('')

  const formatPhone = (phone) => phone ? phone.replace(/@s\.whatsapp\.net|@lid|@c\.us/g, '') : '';

  const fetchData = async () => {
    const { data: appData } = await supabase.from('applicants').select('*').order('created_at', { ascending: false })
    if (appData) setApplicants(appData)

    const { data: areaData } = await supabase.from('areas').select('*').order('sort_order', { ascending: true })
    if (areaData) setAreas(areaData)

    const { data: flowData } = await supabase.from('bot_flow').select('*').order('step_order', { ascending: true })
    if (flowData) setBotFlow(flowData)
  }

  useEffect(() => {
    fetchData()
  }, [])

  // جلب رسائل الشات الحقيقية اللايف وتحديثها كل ثانيتين
  useEffect(() => {
    if (selectedApplicant) {
      fetchLiveMessages(selectedApplicant)
      const interval = setInterval(() => {
        fetchLiveMessages(selectedApplicant)
      }, 2000)
      return () => clearInterval(interval)
    }
  }, [selectedApplicant])

  const fetchLiveMessages = async (applicant) => {
    if (!applicant) return;
    const cleanPhone = formatPhone(applicant.phone_number);

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`applicant_id.eq.${applicant.id},phone_number.eq.${applicant.phone_number},phone_number.eq.${cleanPhone}`)
      .order('created_at', { ascending: true });
    
    if (!error && data) {
      setLiveMessages(data);
    }
  }

  const handleUpdateStatus = async (applicantId, newStatus) => {
    await supabase.from('applicants').update({ status: newStatus }).eq('id', applicantId)
    setSelectedApplicant(prev => ({ ...prev, status: newStatus }))
    fetchData()
  }

  const handleSaveBotStep = async (e) => {
    e.preventDefault()
    if (!newQuestionText || !newKeyToSave) return

    if (editingId) {
      await supabase.from('bot_flow').update({
        question_text: newQuestionText,
        key_to_save: newKeyToSave,
        is_area_question: isAreaQuestion,
        area_id: isAreaQuestion ? selectedAreaId : null
      }).eq('id', editingId)
      setEditingId(null)
    } else {
      const nextOrder = botFlow.length + 1
      await supabase.from('bot_flow').insert([{
        step_order: nextOrder,
        question_text: newQuestionText,
        key_to_save: newKeyToSave,
        is_area_question: isAreaQuestion,
        area_id: isAreaQuestion ? selectedAreaId : null
      }])
    }

    setNewQuestionText('')
    setNewKeyToSave('')
    setIsAreaQuestion(false)
    setSelectedAreaId('')
    fetchData()
  }

  const handleDeleteBotStep = async (id) => {
    await supabase.from('bot_flow').delete().eq('id', id)
    fetchData()
  }

  const handleMoveStep = async (index, direction) => {
    const newFlow = [...botFlow]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newFlow.length) return

    const temp = newFlow[index].step_order
    newFlow[index].step_order = newFlow[targetIndex].step_order
    newFlow[targetIndex].step_order = temp

    await supabase.from('bot_flow').update({ step_order: newFlow[index].step_order }).eq('id', newFlow[index].id)
    await supabase.from('bot_flow').update({ step_order: newFlow[targetIndex].step_order }).eq('id', newFlow[targetIndex].id)
    fetchData()
  }

  const handleAddArea = async (e) => {
    e.preventDefault()
    if (!newAreaName) return
    await supabase.from('areas').insert([{ name: newAreaName, details: newAreaDetails, is_active: true }])
    setNewAreaName('')
    setNewAreaDetails('')
    setShowAddAreaModal(false)
    fetchData()
  }

  const toggleAreaStatus = async (id, currentStatus) => {
    await supabase.from('areas').update({ is_active: !currentStatus }).eq('id', id)
    fetchData()
  }

  const handleDeleteArea = async (id) => {
    await supabase.from('areas').delete().eq('id', id)
    fetchData()
  }

  const filteredApplicants = applicants.filter(a => 
    a.phone_number.includes(searchQuery) || (a.status && a.status.includes(searchQuery))
  )

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800" dir="rtl" style={{ fontFamily: 'Tahoma, Arial, sans-serif' }}>
      
      {/* القائمة الجانبية */}
      <div className="w-64 bg-slate-900 text-white flex flex-col shadow-xl">
        <div className="p-6 text-2xl font-bold border-b border-slate-800 flex items-center gap-3">
          <LayoutDashboard className="w-8 h-8 text-teal-400" />
          <span>مسار</span>
        </div>
        <div className="flex-1 py-6">
          <p className="px-6 text-xs text-slate-400 mb-4 font-semibold tracking-wider">مساحة العمل</p>
          <ul className="space-y-1">
            <li onClick={() => setActiveTab('overview')} className={`px-6 py-3.5 flex items-center gap-3 font-medium cursor-pointer transition-colors ${activeTab === 'overview' ? 'bg-teal-500/10 text-teal-400 border-r-4 border-teal-400' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'}`}>
              <LayoutDashboard className="w-5 h-5" /> نظرة عامة
            </li>
            <li onClick={() => setActiveTab('applicants')} className={`px-6 py-3.5 flex items-center gap-3 font-medium cursor-pointer transition-colors ${activeTab === 'applicants' ? 'bg-teal-500/10 text-teal-400 border-r-4 border-teal-400' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'}`}>
              <Users className="w-5 h-5" /> المتقدمون
            </li>
            <li onClick={() => setActiveTab('areas')} className={`px-6 py-3.5 flex items-center gap-3 font-medium cursor-pointer transition-colors ${activeTab === 'areas' ? 'bg-teal-500/10 text-teal-400 border-r-4 border-teal-400' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'}`}>
              <MapPin className="w-5 h-5" /> مناطق التوصيل
            </li>
            <li onClick={() => setActiveTab('botflow')} className={`px-6 py-3.5 flex items-center gap-3 font-medium cursor-pointer transition-colors ${activeTab === 'botflow' ? 'bg-teal-500/10 text-teal-400 border-r-4 border-teal-400' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'}`}>
              <HelpCircle className="w-5 h-5" /> أسئلة محادثة البوت
            </li>
            <li onClick={() => setActiveTab('whatsapp')} className={`px-6 py-3.5 flex items-center gap-3 font-medium cursor-pointer transition-colors ${activeTab === 'whatsapp' ? 'bg-teal-500/10 text-teal-400 border-r-4 border-teal-400' : 'text-slate-300 hover:text-white hover:bg-slate-800/60'}`}>
              <MessageCircle className="w-5 h-5" /> أرقام واتساب
            </li>
          </ul>
        </div>
      </div>

      {/* المحتوى الرئيسي */}
      <div className="flex-1 overflow-y-auto p-8">
        
        {/* 1. نظرة عامة */}
        {activeTab === 'overview' && (
          <div>
            <div className="flex justify-between items-center mb-8">
              <div>
                <h1 className="text-3xl font-black text-slate-900 mb-1">لوحة تحكم مسار ✨</h1>
                <p className="text-slate-500">نظام إدارة ومتابعة المتقدمين لوظيفة ديليفري بريدفاست.</p>
              </div>
              <button onClick={fetchData} className="bg-white border border-slate-200 text-slate-700 px-5 py-2.5 rounded-xl flex items-center gap-2 hover:bg-slate-50 shadow-sm font-medium">
                🔄 تحديث البيانات
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                <div className="bg-blue-50 p-4 rounded-xl text-blue-600"><Inbox className="w-7 h-7" /></div>
                <div><span className="text-slate-400 text-xs font-semibold block mb-1">الطلبات المحتملة</span><span className="text-2xl font-black text-slate-800">{applicants.length}</span></div>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                <div className="bg-amber-50 p-4 rounded-xl text-amber-600"><FileText className="w-7 h-7" /></div>
                <div><span className="text-slate-400 text-xs font-semibold block mb-1">طلبات جديدة</span><span className="text-2xl font-black text-slate-800">{applicants.filter(a => a.status === 'رسالة جديدة' || a.status === 'جديد').length}</span></div>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                <div className="bg-purple-50 p-4 rounded-xl text-purple-600"><Clock className="w-7 h-7" /></div>
                <div><span className="text-slate-400 text-xs font-semibold block mb-1">قيد المراجعة</span><span className="text-2xl font-black text-slate-800">{applicants.filter(a => a.status === 'قيد المراجعة').length}</span></div>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
                <div className="bg-emerald-50 p-4 rounded-xl text-emerald-600"><CheckCircle className="w-7 h-7" /></div>
                <div><span className="text-slate-400 text-xs font-semibold block mb-1">تم التواصل</span><span className="text-2xl font-black text-slate-800">{applicants.filter(a => a.status === 'تم التواصل').length}</span></div>
              </div>
            </div>
          </div>
        )}

        {/* 2. صفحة المتقدمون */}
        {activeTab === 'applicants' && (
          <div>
            <div className="flex justify-between items-center mb-8">
              <div>
                <h1 className="text-3xl font-black text-slate-900 mb-1">المتقدمون 👥</h1>
                <p className="text-slate-500">تابع المتقدمين وراجع بياناتهم في مكان واحد.</p>
              </div>
              <button onClick={fetchData} className="bg-white border border-slate-200 text-slate-700 px-5 py-2.5 rounded-xl flex items-center gap-2 hover:bg-slate-50 shadow-sm font-medium">
                🔄 تحديث البيانات
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
                <h2 className="text-lg font-bold text-slate-800">طلبات المتقدمين ({filteredApplicants.length})</h2>
                <div className="relative">
                  <input 
                    type="text" 
                    placeholder="ابحث برقم الهاتف..." 
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="pl-4 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 w-72" 
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-3.5" />
                </div>
              </div>

              <table className="w-full text-right">
                <thead>
                  <tr className="bg-slate-50/70 text-slate-400 text-xs font-semibold border-b border-slate-100">
                    <th className="p-4">المتقدم (رقم الهاتف)</th>
                    <th className="p-4">المنطقة</th>
                    <th className="p-4">حالة المحادثة</th>
                    <th className="p-4">حالة المراجعة</th>
                    <th className="p-4">تاريخ التقديم</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApplicants.map((applicant) => (
                    <tr 
                      key={applicant.id} 
                      onClick={() => setSelectedApplicant(applicant)}
                      className="border-b border-slate-50 hover:bg-slate-50/80 cursor-pointer transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-sm">م</div>
                          <div>
                            <div className="font-bold text-slate-800">متقدم واتساب</div>
                            <div className="text-xs text-slate-400 font-mono" dir="ltr">{formatPhone(applicant.phone_number)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 text-slate-600 font-medium">-</td>
                      <td className="p-4"><span className="text-slate-700 font-medium text-sm">جاهز للمراجعة</span></td>
                      <td className="p-4">
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-teal-50 text-teal-700 border border-teal-100">
                          {applicant.status || 'جديد'}
                        </span>
                      </td>
                      <td className="p-4 text-slate-400 text-sm">{new Date(applicant.created_at).toLocaleDateString('ar-EG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. إدارة المناطق */}
        {activeTab === 'areas' && (
          <div>
            <div className="flex justify-between items-center mb-8">
              <div>
                <h1 className="text-3xl font-black text-slate-900 mb-1">مناطق التوصيل 📍</h1>
                <p className="text-slate-500">إدارة المناطق وتفاصيل الشغل.</p>
              </div>
              <button onClick={() => setShowAddAreaModal(true)} className="bg-teal-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-teal-700 shadow-sm">
                <Plus className="w-5 h-5" /> إضافة منطقة
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {areas.map(area => (
                <div key={area.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">{area.name}</h3>
                    <p className="text-slate-500 text-sm mb-6">{area.details || 'لم تُصف تفاصيل لهذه المنطقة بعد.'}</p>
                  </div>
                  <div className="flex items-center gap-2 pt-4 border-t border-slate-100">
                    <button onClick={() => toggleAreaStatus(area.id, area.is_active)} className={`flex-1 py-2 rounded-xl text-xs font-bold border ${area.is_active ? 'border-rose-200 text-rose-600 hover:bg-rose-50' : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}>
                      {area.is_active ? 'إيقاف' : 'تفعيل'}
                    </button>
                    <button onClick={() => handleDeleteArea(area.id)} className="p-2 border border-slate-200 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {showAddAreaModal && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white p-8 rounded-2xl w-full max-w-md shadow-2xl">
                  <h2 className="text-xl font-bold text-slate-900 mb-4">إضافة منطقة جديدة</h2>
                  <form onSubmit={handleAddArea} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">اسم المنطقة</label>
                      <input type="text" value={newAreaName} onChange={e => setNewAreaName(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none" required />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">تفاصيل الشغل</label>
                      <textarea value={newAreaDetails} onChange={e => setNewAreaDetails(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none h-24" />
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button type="submit" className="flex-1 bg-teal-600 text-white py-3 rounded-xl font-bold">حفظ</button>
                      <button type="button" onClick={() => setShowAddAreaModal(false)} className="px-5 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold">إلغاء</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. أسئلة محادثة البوت */}
        {activeTab === 'botflow' && (
          <div>
            <h1 className="text-3xl font-black text-slate-900 mb-1">أسئلة محادثة البوت 🤖</h1>
            <p className="text-slate-500 mb-8">إضافة وتعديل وترتيب أسئلة البوت.</p>

            <form onSubmit={handleSaveBotStep} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 mb-8 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">نص السؤال</label>
                  <input type="text" placeholder="مثال: في أي منطقة تود العمل؟" value={newQuestionText} onChange={e => setNewQuestionText(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">نوع البيانات (Key)</label>
                  <input type="text" placeholder="مثال: selected_area" value={newKeyToSave} onChange={e => setNewKeyToSave(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none" required />
                </div>
              </div>
              <button type="submit" className="bg-teal-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-teal-700">
                <Plus className="w-5 h-5" /> إضافة السؤال للتدفق
              </button>
            </form>

            <div className="space-y-4">
              {botFlow.map((step, index) => (
                <div key={step.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col gap-1">
                      <button onClick={() => handleMoveStep(index, 'up')} className="text-slate-400 p-1 bg-slate-50 rounded-md"><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleMoveStep(index, 'down')} className="text-slate-400 p-1 bg-slate-50 rounded-md"><ArrowDown className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold">{step.step_order}</div>
                    <div>
                      <h4 className="font-bold text-slate-800 text-base mb-1">{step.question_text}</h4>
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md font-mono">متغير: {step.key_to_save}</span>
                    </div>
                  </div>
                  <button onClick={() => handleDeleteBotStep(step.id)} className="text-rose-500 p-2"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5. أرقام واتساب */}
        {activeTab === 'whatsapp' && (
          <div>
            <h1 className="text-3xl font-black text-slate-900 mb-1">إدارة أرقام واتساب 📱</h1>
            <p className="text-slate-500 mb-8">ربط وقطع اتصال الواتساب.</p>
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-700 block mb-1">الحالة: متصل وجاهز للاستقبال</span>
                <span className="text-sm text-slate-400" dir="ltr">{linkedPhone}</span>
              </div>
              <button 
                onClick={() => alert('تم قطع الاتصال بنجاح')} 
                className="bg-rose-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-rose-700 transition-colors shadow-sm"
              >
                قطع الاتصال / إيقاف
              </button>
            </div>
          </div>
        )}
      </div>

      {/* نافذة الشات الجانبي الحقيقي اللايف ورقم المتقدم الحقيقي */}
      {selectedApplicant && (
        <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
          <div className="w-full max-w-lg bg-white h-full p-6 shadow-2xl overflow-y-auto flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center border-b border-slate-100 pb-4 mb-6">
                <h2 className="text-xl font-bold text-slate-800">ملف المتقدم</h2>
                <button onClick={() => setSelectedApplicant(null)} className="text-slate-400 hover:text-slate-600 font-bold text-xl">✕</button>
              </div>

              <div className="mb-6">
                <h3 className="text-lg font-bold text-slate-900 mb-1">متقدم واتساب</h3>
                <p className="text-sm text-teal-600 font-mono font-bold" dir="ltr">{formatPhone(selectedApplicant.phone_number)}</p>
              </div>

              {/* سجل المحادثة اللايف الحقيقي من قاعدة البيانات */}
              <div className="space-y-6">
                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">سجل المحادثة اللايف (Live Chat)</h4>
                  <div className="space-y-3 max-h-72 overflow-y-auto text-sm">
                    {liveMessages.length === 0 ? (
                      <p className="text-slate-400 text-center py-4 text-xs">لا توجد رسائل مسجلة لهذا الرقم حتى الآن.</p>
                    ) : (
                      liveMessages.map((msg, idx) => {
                        const isBot = msg.sender_type === 'bot' || msg.sender === 'bot';
                        return (
                          <div key={idx} className={`p-3 rounded-xl border shadow-sm ${isBot ? 'bg-white border-slate-100 text-slate-800' : 'bg-teal-50 border-teal-100 mr-6 text-slate-800'}`}>
                            <span className={`text-xs font-bold block mb-1 ${isBot ? 'text-teal-600' : 'text-slate-500'}`}>
                              {isBot ? 'البوت:' : 'المتقدم:'}
                            </span>
                            {msg.message_text || msg.message}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-100">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">حالة المراجعة (تعديل تفاعلي)</label>
                  <select 
                    value={selectedApplicant.status || 'جديد'} 
                    onChange={(e) => handleUpdateStatus(selectedApplicant.id, e.target.value)}
                    className="w-full p-3 border border-slate-200 rounded-xl font-bold text-teal-700 bg-teal-50/50 outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="جديد">جديد</option>
                    <option value="قيد المراجعة">قيد المراجعة</option>
                    <option value="تم التواصل">تم التواصل</option>
                    <option value="معلق">معلق</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 mt-6">
              <button onClick={() => setSelectedApplicant(null)} className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800">
                إغلاق الملف
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}