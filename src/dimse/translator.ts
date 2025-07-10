import { DicomDataset, DicomWebStudy, DicomWebSeries, DicomWebInstance, QidoQuery } from '../types';

export class DicomWebTranslator {
  
  public static createQueryDataset(query: QidoQuery): DicomDataset {
    const elements: Record<string, unknown> = {};

    if (query.studyInstanceUID) {
      elements['StudyInstanceUID'] = query.studyInstanceUID;
    }
    if (query.seriesInstanceUID) {
      elements['SeriesInstanceUID'] = query.seriesInstanceUID;
    }
    if (query.sopInstanceUID) {
      elements['SOPInstanceUID'] = query.sopInstanceUID;
    }
    if (query.patientName) {
      elements['PatientName'] = query.patientName;
    }
    if (query.patientID) {
      elements['PatientID'] = query.patientID;
    }
    if (query.accessionNumber) {
      elements['AccessionNumber'] = query.accessionNumber;
    }
    if (query.studyDate) {
      elements['StudyDate'] = query.studyDate;
    }
    if (query.studyTime) {
      elements['StudyTime'] = query.studyTime;
    }
    if (query.modalitiesInStudy) {
      elements['ModalitiesInStudy'] = query.modalitiesInStudy;
    }
    if (query.institutionName) {
      elements['InstitutionName'] = query.institutionName;
    }

    return elements;
  }

  public static datasetToStudy(dataset: DicomDataset): DicomWebStudy {
    const elements = (dataset as any).getElements ? (dataset as any).getElements() : dataset;
    return {
      StudyInstanceUID: elements['StudyInstanceUID'] || '',
      StudyDate: elements['StudyDate'],
      StudyTime: elements['StudyTime'],
      AccessionNumber: elements['AccessionNumber'],
      ReferringPhysicianName: elements['ReferringPhysicianName'],
      PatientName: elements['PatientName'],
      PatientID: elements['PatientID'],
      PatientBirthDate: elements['PatientBirthDate'],
      PatientSex: elements['PatientSex'],
      StudyDescription: elements['StudyDescription'],
      ModalitiesInStudy: elements['ModalitiesInStudy'] ? 
        (Array.isArray(elements['ModalitiesInStudy']) ? elements['ModalitiesInStudy'] : [elements['ModalitiesInStudy']]) : 
        undefined as string[] | undefined,
      NumberOfStudyRelatedSeries: elements['NumberOfStudyRelatedSeries'],
      NumberOfStudyRelatedInstances: elements['NumberOfStudyRelatedInstances'],
    };
  }

  public static datasetToSeries(dataset: DicomDataset): DicomWebSeries {
    const elements = (dataset as any).getElements ? (dataset as any).getElements() : dataset;
    return {
      StudyInstanceUID: elements['StudyInstanceUID'] || '',
      SeriesInstanceUID: elements['SeriesInstanceUID'] || '',
      SeriesDate: elements['SeriesDate'],
      SeriesTime: elements['SeriesTime'],
      Modality: elements['Modality'],
      SeriesDescription: elements['SeriesDescription'],
      SeriesNumber: elements['SeriesNumber'],
      NumberOfSeriesRelatedInstances: elements['NumberOfSeriesRelatedInstances'],
      BodyPartExamined: elements['BodyPartExamined'],
      ProtocolName: elements['ProtocolName'],
      OperatorsName: elements['OperatorsName'],
    };
  }

  public static datasetToInstance(dataset: DicomDataset): DicomWebInstance {
    const elements = (dataset as any).getElements ? (dataset as any).getElements() : dataset;
    return {
      StudyInstanceUID: elements['StudyInstanceUID'] || '',
      SeriesInstanceUID: elements['SeriesInstanceUID'] || '',
      SOPInstanceUID: elements['SOPInstanceUID'] || '',
      SOPClassUID: elements['SOPClassUID'],
      InstanceNumber: elements['InstanceNumber'],
      ContentDate: elements['ContentDate'],
      ContentTime: elements['ContentTime'],
      NumberOfFrames: elements['NumberOfFrames'],
      Rows: elements['Rows'],
      Columns: elements['Columns'],
      BitsAllocated: elements['BitsAllocated'],
      BitsStored: elements['BitsStored'],
      HighBit: elements['HighBit'],
      PixelRepresentation: elements['PixelRepresentation'],
      PhotometricInterpretation: elements['PhotometricInterpretation'],
      TransferSyntaxUID: elements['TransferSyntaxUID'],
    };
  }

  public static applyWildcardMatching(value: string, minChars: number = 0, appendWildcard: boolean = true): string {
    if (!value) return '';
    
    if (value.length < minChars) {
      return value;
    }
    
    if (appendWildcard && !value.includes('*') && !value.includes('?')) {
      return `${value}*`;
    }
    
    return value;
  }

  public static convertToDicomDate(date: string): string {
    if (!date) return '';
    
    const cleanDate = date.replace(/[-\/]/g, '');
    
    if (cleanDate.length === 8) {
      return cleanDate;
    }
    
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return '';
    }
    
    return dateObj.toISOString().substring(0, 10).replace(/-/g, '');
  }

  public static convertToDicomTime(time: string): string {
    if (!time) return '';
    
    const cleanTime = time.replace(/[:]/g, '');
    
    if (cleanTime.length >= 6) {
      return cleanTime.substring(0, 6);
    }
    
    const timeObj = new Date(`2000-01-01T${time}`);
    if (isNaN(timeObj.getTime())) {
      return '';
    }
    
    return timeObj.toTimeString().substring(0, 8).replace(/:/g, '');
  }

  public static formatDicomWebDate(dicomDate: string): string {
    if (!dicomDate || dicomDate.length !== 8) return dicomDate;
    
    return `${dicomDate.substring(0, 4)}-${dicomDate.substring(4, 6)}-${dicomDate.substring(6, 8)}`;
  }

  public static formatDicomWebTime(dicomTime: string): string {
    if (!dicomTime || dicomTime.length < 6) return dicomTime;
    
    return `${dicomTime.substring(0, 2)}:${dicomTime.substring(2, 4)}:${dicomTime.substring(4, 6)}`;
  }

  public static createDicomWebResponse(data: any, contentType: string = 'application/dicom+json'): string {
    if (contentType === 'application/dicom+json') {
      return JSON.stringify(data, null, 2);
    }
    
    return JSON.stringify(data);
  }

  public static parseDicomWebQuery(queryString: string): Record<string, string> {
    const params: Record<string, string> = {};
    
    if (!queryString) return params;
    
    const pairs = queryString.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value) {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      }
    }
    
    return params;
  }

  public static validateStudyInstanceUID(uid: string): boolean {
    if (!uid) return false;
    
    const uidRegex = /^[0-9]+(\.[0-9]+)*$/;
    return uidRegex.test(uid) && uid.length <= 64;
  }

  public static validateSeriesInstanceUID(uid: string): boolean {
    return this.validateStudyInstanceUID(uid);
  }

  public static validateSOPInstanceUID(uid: string): boolean {
    return this.validateStudyInstanceUID(uid);
  }

  public static sanitizePatientName(name: string): string {
    if (!name) return '';
    
    return name.replace(/[^a-zA-Z0-9\s\^\-]/g, '').trim();
  }

  public static sanitizePatientID(id: string): string {
    if (!id) return '';
    
    return id.replace(/[^a-zA-Z0-9\-]/g, '').trim();
  }

  public static createMultipartBoundary(): string {
    return `----DICOMwebBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
  }

  public static createMultipartResponse(instances: Buffer[], boundary: string): Buffer {
    const parts: Buffer[] = [];
    
    for (const instance of instances) {
      const headers = [
        `--${boundary}`,
        'Content-Type: application/dicom',
        `Content-Length: ${instance.length}`,
        '',
        ''
      ].join('\r\n');
      
      parts.push(Buffer.from(headers));
      parts.push(instance);
      parts.push(Buffer.from('\r\n'));
    }
    
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    
    return Buffer.concat(parts);
  }
}