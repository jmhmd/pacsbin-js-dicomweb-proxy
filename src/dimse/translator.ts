import { DicomDataset, DicomWebJson, QidoQuery } from '../types';
import { Buffer } from 'node:buffer';
import * as dcmjs from 'dcmjs';

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

  public static datasetToStudy(dataset: DicomDataset): DicomWebJson {
    const elements = (dataset as any).getElements ? (dataset as any).getElements() : dataset;
    
    // Convert to DICOMweb JSON format using dcmjs
    try {
      const dicomwebJson = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(elements);
      return dicomwebJson;
    } catch (error) {
      console.warn('Failed to denaturalize dataset, falling back to basic conversion:', error);
      
      // Fallback: manual conversion for essential study fields
      const result: Record<string, any> = {};
      
      if (elements['StudyInstanceUID']) {
        result['0020000D'] = { vr: 'UI', Value: [elements['StudyInstanceUID']] };
      }
      if (elements['StudyDate']) {
        result['00080020'] = { vr: 'DA', Value: [elements['StudyDate']] };
      }
      if (elements['StudyTime']) {
        result['00080030'] = { vr: 'TM', Value: [elements['StudyTime']] };
      }
      if (elements['AccessionNumber']) {
        result['00080050'] = { vr: 'SH', Value: [elements['AccessionNumber']] };
      }
      if (elements['PatientName']) {
        result['00100010'] = { vr: 'PN', Value: [elements['PatientName']] };
      }
      if (elements['PatientID']) {
        result['00100020'] = { vr: 'LO', Value: [elements['PatientID']] };
      }
      if (elements['StudyDescription']) {
        result['00081030'] = { vr: 'LO', Value: [elements['StudyDescription']] };
      }
      
      return result;
    }
  }

  public static datasetToSeries(dataset: DicomDataset): DicomWebJson {
    const elements = (dataset as any).getElements ? (dataset as any).getElements() : dataset;
    
    // Convert to DICOMweb JSON format using dcmjs
    try {
      const dicomwebJson = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(elements);
      return dicomwebJson;
    } catch (error) {
      console.warn('Failed to denaturalize dataset, falling back to basic conversion:', error);
      
      // Fallback: manual conversion for essential series fields
      const result: Record<string, any> = {};
      
      if (elements['StudyInstanceUID']) {
        result['0020000D'] = { vr: 'UI', Value: [elements['StudyInstanceUID']] };
      }
      if (elements['SeriesInstanceUID']) {
        result['0020000E'] = { vr: 'UI', Value: [elements['SeriesInstanceUID']] };
      }
      if (elements['SeriesDate']) {
        result['00080021'] = { vr: 'DA', Value: [elements['SeriesDate']] };
      }
      if (elements['SeriesTime']) {
        result['00080031'] = { vr: 'TM', Value: [elements['SeriesTime']] };
      }
      if (elements['Modality']) {
        result['00080060'] = { vr: 'CS', Value: [elements['Modality']] };
      }
      if (elements['SeriesDescription']) {
        result['0008103E'] = { vr: 'LO', Value: [elements['SeriesDescription']] };
      }
      if (elements['SeriesNumber']) {
        result['00200011'] = { vr: 'IS', Value: [elements['SeriesNumber']] };
      }
      
      return result;
    }
  }

  public static datasetToInstance(dataset: DicomDataset): DicomWebJson {
    const elements = (dataset as any).getElements ? (dataset as any).getElements() : dataset;
    
    // Convert to DICOMweb JSON format using dcmjs
    try {
      const dicomwebJson = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(elements);
      return dicomwebJson;
    } catch (error) {
      console.warn('Failed to denaturalize dataset, falling back to basic conversion:', error);
      
      // Fallback: manual conversion for essential instance fields
      const result: Record<string, any> = {};
      
      if (elements['StudyInstanceUID']) {
        result['0020000D'] = { vr: 'UI', Value: [elements['StudyInstanceUID']] };
      }
      if (elements['SeriesInstanceUID']) {
        result['0020000E'] = { vr: 'UI', Value: [elements['SeriesInstanceUID']] };
      }
      if (elements['SOPInstanceUID']) {
        result['00080018'] = { vr: 'UI', Value: [elements['SOPInstanceUID']] };
      }
      if (elements['SOPClassUID']) {
        result['00080016'] = { vr: 'UI', Value: [elements['SOPClassUID']] };
      }
      if (elements['InstanceNumber']) {
        result['00200013'] = { vr: 'IS', Value: [elements['InstanceNumber']] };
      }
      if (elements['ContentDate']) {
        result['00080023'] = { vr: 'DA', Value: [elements['ContentDate']] };
      }
      if (elements['ContentTime']) {
        result['00080033'] = { vr: 'TM', Value: [elements['ContentTime']] };
      }
      if (elements['Rows']) {
        result['00280010'] = { vr: 'US', Value: [elements['Rows']] };
      }
      if (elements['Columns']) {
        result['00280011'] = { vr: 'US', Value: [elements['Columns']] };
      }
      
      return result;
    }
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

  public static createDicomWebResponse(data: any, contentType: string = 'application/dicom+json'): string {
    if (contentType === 'application/dicom+json') {
      return JSON.stringify(data, null, 2);
    }
    
    return JSON.stringify(data);
  }

  /**
   * Validates DICOM UID format according to DICOM standard
   * UIDs must contain only digits and dots, and be <= 64 characters
   * @param uid The UID to validate
   * @returns true if valid, false otherwise
   */
  public static validateUID(uid: string): boolean {
    if (!uid) return false;
    
    const uidRegex = /^[0-9]+(\.[0-9]+)*$/;
    return uidRegex.test(uid) && uid.length <= 64;
  }

  // Legacy methods for backward compatibility
  public static validateStudyInstanceUID(uid: string): boolean {
    return this.validateUID(uid);
  }

  public static validateSeriesInstanceUID(uid: string): boolean {
    return this.validateUID(uid);
  }

  public static validateSOPInstanceUID(uid: string): boolean {
    return this.validateUID(uid);
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