export interface Resume {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  primaryRole: string;
  skills: string[];
  workExperience?: string;
  education?: string;
  projects?: string;
  location?: string;
  fileUrl: string;
  fileName: string;
  fileType: string;
  createdAt: any;
  ownerId: string;
}

export interface Folder {
  id: string;
  roleName: string;
  resumeCount: number;
  ownerId: string;
}
