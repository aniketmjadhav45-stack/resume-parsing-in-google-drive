import React, { useState, useEffect, useMemo } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  addDoc, 
  updateDoc, 
  doc, 
  getDocs,
  handleFirestoreError,
  OperationType,
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  serverTimestamp
} from './firebase';
import { Resume, Folder } from './types';
import { extractResumeData } from './services/gemini';
import * as mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';

// Configure pdfjs worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

async function extractTextFromFile(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  
  if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item: any) => (item as any).str);
      fullText += strings.join(' ') + '\n';
    }
    return fullText;
  }
  return '';
}

import { 
  Search, 
  Plus, 
  Folder as FolderIcon, 
  FileText, 
  LogOut, 
  Upload, 
  Loader2, 
  X, 
  Mail, 
  Phone, 
  MapPin, 
  ExternalLink, 
  Download,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(localStorage.getItem('google_access_token'));
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplay, setAuthDisplay] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedResume, setSelectedResume] = useState<Resume | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    candidate_name: string;
    detected_role: string;
    folder_created: boolean;
    folder_path: string;
    duplicate_found: boolean;
    matched_candidate: string;
    action_taken: string;
  } | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Clear status after 5 seconds
  useEffect(() => {
    if (uploadStatus) {
      const timer = setTimeout(() => setUploadStatus(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [uploadStatus]);

  // Real-time Resumes
  useEffect(() => {
    if (!user) {
      setResumes([]);
      return;
    }

    const q = query(
      collection(db, 'resumes'),
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => {
        const data = doc.data();
        return { 
          id: doc.id, 
          ...data,
          createdAt: data.createdAt?.toDate?.() ? data.createdAt.toDate().toISOString() : data.createdAt 
        } as Resume;
      });
      setResumes(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'resumes');
    });

    return () => unsubscribe();
  }, [user]);

  // Real-time Folders
  useEffect(() => {
    if (!user) {
      setFolders([]);
      return;
    }

    const q = query(
      collection(db, 'folders'),
      where('ownerId', '==', user.uid),
      orderBy('roleName', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Folder));
      setFolders(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'folders');
    });

    return () => unsubscribe();
  }, [user]);

  const filteredFolders = useMemo(() => {
    return folders.filter(folder => 
      folder.roleName.toLowerCase().includes(folderSearchQuery.toLowerCase())
    );
  }, [folders, folderSearchQuery]);

  const recentResumes = useMemo(() => {
    return resumes.slice(0, 5);
  }, [resumes]);

  const filteredResumes = useMemo(() => {
    return resumes.filter(resume => {
      const matchesSearch = 
        resume.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        resume.skills.some(skill => skill.toLowerCase().includes(searchQuery.toLowerCase())) ||
        resume.email.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesFolder = selectedFolder 
        ? resume.primaryRole.toLowerCase() === selectedFolder.toLowerCase()
        : true;

      return matchesSearch && matchesFolder;
    });
  }, [resumes, searchQuery, selectedFolder]);

  const handleGoogleDriveSync = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGoogleAccessToken(credential.accessToken);
        localStorage.setItem('google_access_token', credential.accessToken);
      }
    } catch (error) {
      console.error('Google Drive connection failed:', error);
      alert('Failed to connect to Google Drive. Please try again.');
    }
  };

  const handleEmailPasswordAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsResending(true);
    
    try {
      if (isSignup) {
        const result = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        if (authDisplay) {
          await updateProfile(result.user, { displayName: authDisplay });
        }
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
      }
    } catch (error: any) {
      console.error('Auth failed:', error);
      setAuthError(error.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setIsResending(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setGoogleAccessToken(null);
      localStorage.removeItem('google_access_token');
      setSelectedResume(null);
      setSelectedFolder(null);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsUploading(true);
    try {
      // 1. Upload to server
      const formData = new FormData();
      formData.append('resume', file);
      
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      
      if (!uploadRes.ok) throw new Error('Upload failed');
      const uploadData = await uploadRes.json();
      const { url, fileName, fileType, localPath } = uploadData;

      // 2. Extract text for Gemini
      const textContent = await extractTextFromFile(file);

      // 3. Extract structured data with Gemini
      const extractedData = await extractResumeData({ 
        textContent,
        base64Data: fileType === 'application/pdf' ? undefined : undefined, // We prefer text now for reliability
        mimeType: fileType 
      });

      // 4. Normalize Primary Role for Folder System
      const roleMapping: Record<string, string> = {
        'qa automation engineer': 'QA Automation Testing',
        'automation test engineer': 'QA Automation Testing',
        'software test engineer (automation)': 'QA Automation Testing',
        'sdet': 'QA Automation Testing',
        'manual tester': 'Manual Testing',
        'qa tester': 'Manual Testing',
        'frontend engineer': 'Frontend Developer',
        'react developer': 'Frontend Developer',
        'frontend react developer': 'Frontend Developer',
        'backend engineer': 'Backend Developer',
        'node.js developer': 'Backend Developer',
        'full stack engineer': 'Full Stack Developer',
        'web developer': 'Full Stack Developer',
        'data analyst': 'Data Analyst',
        'business intelligence': 'Data Analyst',
        'power bi developer': 'Power BI Developer',
        'power bi dev': 'Power BI Developer',
        'data scientist': 'AI/Data Science',
        'machine learning engineer': 'AI/Data Science',
        'ai engineer': 'AI Engineer',
        'ai/ml engineer': 'AI Engineer',
        'devops engineer': 'DevOps Engineer',
        'sre': 'DevOps Engineer',
        'project manager': 'Product/Project Manager',
        'product manager': 'Product/Project Manager',
        'ui/ux designer': 'UI/UX Designer',
        'product designer': 'UI/UX Designer'
      };

      const rawRole = extractedData.primaryRole || 'Uncategorized';
      const lowercaseRole = rawRole.toLowerCase().trim();
      
      let normalizedRole = roleMapping[lowercaseRole] || 
        rawRole.trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

      // 5. Duplicate Check (Search by Email and User ID)
      const duplicateQuery = query(
        collection(db, 'resumes'),
        where('ownerId', '==', user.uid),
        where('email', '==', extractedData.email)
      );
      let duplicateSnap;
      try {
        duplicateSnap = await getDocs(duplicateQuery);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, 'resumes (duplicate check)');
      }
      
      if (!duplicateSnap) return; // Should not happen with throw
      
      let resumeId = '';
      let duplicateFound = false;
      let folderCreated = false;
      let actionTaken = '';

      const resumeData = {
        ...extractedData,
        primaryRole: normalizedRole,
        fileUrl: url,
        fileName,
        fileType,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
      };

      if (!duplicateSnap.empty) {
        // Update existing record
        const existingDoc = duplicateSnap.docs[0];
        resumeId = existingDoc.id;
        duplicateFound = true;
        actionTaken = 'Duplicate candidate detected. Record updated with newer resume.';
        
        // Update the record
        try {
          await updateDoc(doc(db, 'resumes', resumeId), {
            ...resumeData,
            createdAt: serverTimestamp() // Update timestamp to reflect newest upload
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `resumes/${resumeId}`);
        }
      } else {
        // Create new record
        let docRef;
        try {
          docRef = await addDoc(collection(db, 'resumes'), resumeData);
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'resumes');
        }
        if (!docRef) return;
        
        resumeId = docRef.id;
        duplicateFound = false;
        actionTaken = 'New candidate resume processed and categorized.';
        
        // 6. Update/Create Folder for Primary Role (Only for new candidates or if role changed)
        const folderQuery = query(
          collection(db, 'folders'),
          where('ownerId', '==', user.uid),
          where('roleName', '==', normalizedRole)
        );
        
        let folderSnap;
        try {
          folderSnap = await getDocs(folderQuery);
        } catch (error) {
          handleFirestoreError(error, OperationType.LIST, 'folders (role check)');
        }

        if (!folderSnap) return;
        
        if (folderSnap.empty) {
          try {
            await addDoc(collection(db, 'folders'), {
              roleName: normalizedRole,
              resumeCount: 1,
              ownerId: user.uid
            });
            folderCreated = true;
          } catch (error) {
            handleFirestoreError(error, OperationType.CREATE, 'folders');
          }
        } else {
          const folderDoc = folderSnap.docs[0];
          try {
            await updateDoc(doc(db, 'folders', folderDoc.id), {
              resumeCount: folderDoc.data().resumeCount + 1
            });
            folderCreated = false;
          } catch (error) {
            handleFirestoreError(error, OperationType.UPDATE, `folders/${folderDoc.id}`);
          }
        }
      }

      setUploadStatus({
        candidate_name: extractedData.fullName,
        detected_role: normalizedRole,
        folder_created: folderCreated,
        duplicate_found: duplicateFound,
        action_taken: actionTaken,
        folder_path: `/Resumes/${normalizedRole}/`,
        matched_candidate: duplicateFound ? extractedData.fullName : 'None'
      });

      // 7. Google Drive Sync
      if (googleAccessToken) {
        try {
          await fetch('/api/drive-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accessToken: googleAccessToken,
              roleName: normalizedRole,
              candidateName: extractedData.fullName,
              fileName,
              localPath,
              fileType
            })
          });
        } catch (driveErr) {
          console.error("Sync to Google Drive failed:", driveErr);
        }
      }

      setSelectedResume({ id: resumeId, ...resumeData, createdAt: new Date().toISOString() });
    } catch (error) {
      console.error('Processing failed:', error);
      alert('Failed to process resume. Please try again.');
    } finally {
      setIsUploading(false);
      // Reset input
      e.target.value = '';
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 overflow-hidden relative"
        >
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
            <FileText className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1 text-center">ResumeAI</h1>
          <p className="text-slate-500 mb-8 text-center text-sm">
            {isSignup ? 'Create an account to start managing resumes.' : 'Sign in to access your resume vault.'}
          </p>

          <form onSubmit={handleEmailPasswordAuth} className="space-y-4">
            {isSignup && (
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Full Name</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                    <FileText className="w-4 h-4" />
                  </span>
                  <input 
                    type="text"
                    required
                    placeholder="John Doe"
                    value={authDisplay}
                    onChange={(e) => setAuthDisplay(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Email Address</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <Mail className="w-4 h-4" />
                </span>
                <input 
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Password</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <FileText className="w-4 h-4" />
                </span>
                <input 
                  type="password"
                  required
                  placeholder="••••••••"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
                />
              </div>
            </div>

            {authError && (
              <p className="text-xs text-red-500 mt-2 text-center bg-red-50 p-2 rounded-lg border border-red-100">
                {authError}
              </p>
            )}

            <button 
              type="submit"
              disabled={isResending}
              className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100 disabled:opacity-50 mt-4"
            >
              {isResending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                isSignup ? 'Create Account' : 'Sign In'
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500">
              {isSignup ? 'Already have an account?' : "Don't have an account?"}
              <button 
                onClick={() => {
                  setIsSignup(!isSignup);
                  setAuthError(null);
                }}
                className="ml-2 text-blue-600 font-bold hover:underline"
              >
                {isSignup ? 'Sign In' : 'Sign Up'}
              </button>
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-6 flex items-center gap-3 border-b border-slate-100">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-100">
            <FileText className="text-white w-6 h-6" />
          </div>
          <span className="text-xl font-bold text-slate-900">ResumeAI</span>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-4 mb-3">Main</h3>
            <button 
              onClick={() => setSelectedFolder(null)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all",
                !selectedFolder ? "bg-blue-50 text-blue-600 font-medium" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <FileText className="w-5 h-5" />
              All Resumes
              <span className="ml-auto text-xs bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-500">
                {resumes.length}
              </span>
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between px-4 mb-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Job Roles</h3>
              <Plus className="w-3.5 h-3.5 text-slate-400 cursor-help" />
            </div>
            
            <div className="px-4 mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
                <input 
                  type="text" 
                  placeholder="Search roles..."
                  value={folderSearchQuery}
                  onChange={(e) => setFolderSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              {filteredFolders.map(folder => (
                <button 
                  key={folder.id}
                  onClick={() => setSelectedFolder(folder.roleName)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all text-left group",
                    selectedFolder === folder.roleName ? "bg-blue-50 text-blue-600 font-medium" : "text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                    selectedFolder === folder.roleName ? "bg-blue-100" : "bg-slate-100 group-hover:bg-slate-200"
                  )}>
                    <FolderIcon className={cn("w-4 h-4", selectedFolder === folder.roleName ? "text-blue-600" : "text-slate-500")} />
                  </div>
                  <span className="truncate flex-1 text-sm">{folder.roleName}</span>
                  <span className="text-[10px] font-bold bg-white border border-slate-200 px-1.5 py-0.5 rounded-md text-slate-500">
                    {folder.resumeCount}
                  </span>
                </button>
              ))}
              {folders.length === 0 && (
                <p className="text-sm text-slate-400 px-4 italic">No folders yet.</p>
              )}
              {folders.length > 0 && filteredFolders.length === 0 && (
                <p className="text-sm text-slate-400 px-4 italic">No matching folders.</p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 mb-3">
            {user.photoURL ? (
              <img src={user.photoURL} className="w-10 h-10 rounded-full border-2 border-white shadow-sm" alt={user.displayName || ''} />
            ) : (
              <div className="w-10 h-10 rounded-full border-2 border-white shadow-sm bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
                {user.displayName?.charAt(0) || user.email?.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{user.displayName || user.email?.split('@')[0]}</p>
              {googleAccessToken ? (
                <div className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Drive Sync Active
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 font-medium">Drive Sync Offline</p>
              )}
            </div>
          </div>
          {!googleAccessToken && (
            <button 
              onClick={handleGoogleDriveSync}
              className="w-full mb-3 py-2 px-3 bg-blue-50 text-blue-600 text-xs font-bold rounded-xl hover:bg-blue-100 transition-all flex items-center justify-center gap-2"
            >
              <Upload className="w-3.5 h-3.5" />
              Connect Google Drive
            </button>
          )}
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-slate-600 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
          <div className="flex-1 max-w-2xl relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input 
              type="text" 
              placeholder="Search by name, skill, or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>
          <div className="flex items-center gap-4 ml-8">
            <label className={cn(
              "flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl cursor-pointer transition-all shadow-lg shadow-blue-100",
              isUploading && "opacity-70 cursor-not-allowed"
            )}>
              {isUploading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  Upload Resume
                </>
              )}
              <input 
                type="file" 
                className="hidden" 
                accept=".pdf,.docx,.doc" 
                onChange={handleFileUpload}
                disabled={isUploading}
              />
            </label>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* Top Panel: Preview */}
          <AnimatePresence mode="wait">
            {selectedResume ? (
              <motion.div 
                key={selectedResume.id}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden"
              >
                <div className="p-8">
                  <div className="flex items-start justify-between mb-8">
                    <div className="flex items-center gap-6">
                      <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 font-bold text-3xl">
                        {selectedResume.fullName.charAt(0)}
                      </div>
                      <div>
                        <h2 className="text-3xl font-bold text-slate-900 mb-1">{selectedResume.fullName}</h2>
                        <p className="text-lg font-semibold text-blue-600 mb-2">{selectedResume.primaryRole}</p>
                        <div className="flex flex-wrap gap-4 text-slate-600">
                          <span className="flex items-center gap-1.5 text-sm">
                            <Mail className="w-4 h-4" />
                            {selectedResume.email}
                          </span>
                          {selectedResume.phone && (
                            <span className="flex items-center gap-1.5 text-sm">
                              <Phone className="w-4 h-4" />
                              {selectedResume.phone}
                            </span>
                          )}
                          {selectedResume.location && (
                            <span className="flex items-center gap-1.5 text-sm">
                              <MapPin className="w-4 h-4" />
                              {selectedResume.location}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <a 
                        href={selectedResume.fileUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                        title="View Original"
                      >
                        <ExternalLink className="w-5 h-5" />
                      </a>
                      <button 
                        onClick={() => setSelectedResume(null)}
                        className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-8">
                      <section>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Work Experience</h4>
                        <div className="prose prose-slate max-w-none">
                          <ReactMarkdown>{selectedResume.workExperience || 'No experience details extracted.'}</ReactMarkdown>
                        </div>
                      </section>
                      <section>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Projects</h4>
                        <div className="prose prose-slate max-w-none">
                          <ReactMarkdown>{selectedResume.projects || 'No projects extracted.'}</ReactMarkdown>
                        </div>
                      </section>
                    </div>
                    <div className="space-y-8">
                      <section>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Skills</h4>
                        <div className="flex flex-wrap gap-2">
                          {selectedResume.skills.map(skill => (
                            <span key={skill} className="px-3 py-1 bg-blue-50 text-blue-600 text-sm font-medium rounded-lg">
                              {skill}
                            </span>
                          ))}
                        </div>
                      </section>
                      <section>
                        <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Education</h4>
                        <div className="prose prose-slate max-w-none text-sm">
                          <ReactMarkdown>{selectedResume.education || 'No education details extracted.'}</ReactMarkdown>
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="bg-blue-50 border-2 border-dashed border-blue-200 rounded-2xl p-12 text-center">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <FileText className="text-blue-500 w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-1">Select a resume to view details</h3>
                <p className="text-slate-500">Extracted AI data will appear here for the selected candidate.</p>
              </div>
            )}
          </AnimatePresence>

          {/* Bottom Section: List */}
          <div>
            {!selectedFolder && resumes.length > 0 && (
              <div className="mb-12">
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-blue-500" />
                  Recent Activity
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                  {recentResumes.map(res => (
                    <div 
                      key={res.id} 
                      onClick={() => setSelectedResume(res)}
                      className="p-4 bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                    >
                      <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 text-xs font-bold mb-3 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        {res.fullName.charAt(0)}
                      </div>
                      <p className="text-xs font-bold text-slate-900 truncate">{res.fullName}</p>
                      <p className="text-[10px] text-slate-400 truncate">{res.primaryRole}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-6">
              <div className="flex flex-col">
                <h3 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                  {selectedFolder ? (
                    <>
                      <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                        <FolderIcon className="w-6 h-6 text-blue-600" />
                      </div>
                      {selectedFolder}
                    </>
                  ) : 'Inventory'}
                  <span className="ml-2 text-sm font-normal text-slate-400">({filteredResumes.length} candidates)</span>
                </h3>
                {selectedFolder && (
                  <p className="text-xs text-slate-400 mt-1 ml-12">Path: <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">/Resumes/{selectedFolder}/</span></p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg transition-all border border-transparent hover:border-slate-200">
                  <Filter className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredResumes.map(resume => (
                <motion.div 
                  layout
                  key={resume.id}
                  onClick={() => setSelectedResume(resume)}
                  className={cn(
                    "group bg-white p-6 rounded-2xl border transition-all cursor-pointer hover:shadow-xl hover:shadow-slate-200/50",
                    selectedResume?.id === resume.id ? "border-blue-500 ring-2 ring-blue-500/10" : "border-slate-200"
                  )}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 bg-slate-50 group-hover:bg-blue-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-blue-600 font-bold text-xl transition-colors">
                      {resume.fullName.charAt(0)}
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 px-2 py-1 rounded">
                      {new Date(resume.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1 group-hover:text-blue-600 transition-colors">{resume.fullName}</h4>
                  <p className="text-sm font-semibold text-blue-600 mb-1">{resume.primaryRole}</p>
                  <p className="text-sm text-slate-500 mb-4 truncate">{resume.email}</p>
                  
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {resume.skills.slice(0, 3).map(skill => (
                      <span key={skill} className="px-2 py-0.5 bg-slate-50 text-slate-600 text-[11px] font-medium rounded-md">
                        {skill}
                      </span>
                    ))}
                    {resume.skills.length > 3 && (
                      <span className="px-2 py-0.5 bg-slate-50 text-slate-400 text-[11px] font-medium rounded-md">
                        +{resume.skills.length - 3}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {resume.fileName.length > 20 ? resume.fileName.substring(0, 20) + '...' : resume.fileName}
                    </span>
                    <Download className="w-4 h-4 text-slate-300 group-hover:text-blue-400 transition-colors" />
                  </div>
                </motion.div>
              ))}
              {filteredResumes.length === 0 && (
                <div className="col-span-full py-20 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search className="text-slate-300 w-8 h-8" />
                  </div>
                  <h4 className="text-slate-900 font-bold mb-1">No resumes found</h4>
                  <p className="text-slate-500">Try adjusting your search or filters.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Notifications / Status */}
      <AnimatePresence>
        {uploadStatus && (
          <motion.div 
            initial={{ opacity: 0, y: 100, x: 0 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: 100 }}
            className="fixed bottom-8 right-8 z-50 max-w-sm w-full"
          >
            <div className={cn(
              "bg-white rounded-2xl shadow-2xl border p-6 overflow-hidden relative",
              uploadStatus.duplicate_found ? "border-amber-200" : "border-emerald-200"
            )}>
              <div className={cn(
                "absolute top-0 left-0 w-1 h-full",
                uploadStatus.duplicate_found ? "bg-amber-500" : "bg-emerald-500"
              )} />
              
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center",
                    uploadStatus.duplicate_found ? "bg-amber-50" : "bg-emerald-50"
                  )}>
                    {uploadStatus.duplicate_found ? (
                      <Filter className={cn("w-5 h-5", "text-amber-600")} />
                    ) : (
                      <Upload className={cn("w-5 h-5", "text-emerald-600")} />
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 leading-tight">
                      {uploadStatus.duplicate_found ? 'Duplicate Detected' : 'Resume Processed'}
                    </h4>
                    <p className="text-xs text-slate-500">{uploadStatus.candidate_name}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setUploadStatus(null)}
                  className="text-slate-300 hover:text-slate-500 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div className="text-sm text-slate-600 pb-3 border-b border-slate-100">
                  {uploadStatus.action_taken}
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Detailed Status (JSON)</p>
                  <pre className="text-[10px] bg-slate-50 p-3 rounded-lg overflow-x-auto font-mono text-slate-500">
                    {JSON.stringify({
                      candidate_name: uploadStatus.candidate_name,
                      detected_role: uploadStatus.detected_role,
                      folder_created: uploadStatus.folder_created,
                      folder_path: (uploadStatus as any).folder_path || `/Resumes/${uploadStatus.detected_role}/`,
                      duplicate_found: uploadStatus.duplicate_found,
                      matched_candidate: (uploadStatus as any).matched_candidate || (uploadStatus.duplicate_found ? uploadStatus.candidate_name : "None"),
                      action_taken: uploadStatus.action_taken
                    }, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
