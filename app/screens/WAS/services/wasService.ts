import { Ed25519Signer } from '@did.coop/did-key-ed25519';
import { WalletStorage } from '@did.coop/wallet-attached-storage';
import { v4 as uuidv4 } from 'uuid';

// Types for our service
export interface StorageResult {
  success: boolean;
  resourceName?: string;
  didController?: string;
  error?: string;
}

export interface Credential {
  id: string;
  spaceId: string;
  data: any;
  createdAt: string;
}

class WalletStorageService {
  // Store any type of credential in WAS
  async storeCredential(data: any, resourcePrefix = 'credential'): Promise<StorageResult> {
    try {
      // Generate a signer for this session
      const appDidSigner = await Ed25519Signer.generate();
      const baseDidController = appDidSigner.id.split('#')[0];

      // Create a new space for this credential
      const spaceId = `urn:uuid:${uuidv4()}`;
      const space = await WalletStorage.provisionSpace({
        url: 'https://data.pub',
        signer: appDidSigner,
        id: spaceId as `urn:uuid:${string}`,
      });

      // Set up the space metadata
      const spaceObject = {
        controller: baseDidController,
        type: 'Collection',
        items: [],
        totalItems: 0,
      };
      
      const spaceObjectBlob = new Blob([JSON.stringify(spaceObject)], {
        type: 'application/json',
      });

      await space.put(spaceObjectBlob);

      // Create a descriptive resource name based on the data
      const identifier = data.resumeId || data.credentialId || data.id || Date.now();
      const resourceName = `${resourcePrefix}-${identifier}`;
      
      // Ensure we have a timestamp for organizing/sorting later
      if (!data.timestamp) {
        data.timestamp = new Date().toISOString();
      }

      // Store the credential data
      const credentialBlob = new Blob([JSON.stringify(data)], {
        type: 'application/json',
      });
      
      const resource = space.resource(resourceName);
      await resource.put(credentialBlob);

      console.log(`${resourcePrefix} stored successfully in WAS:`, resourceName);
      
      // Return the result with metadata for further operations
      return {
        success: true,
        resourceName,
        didController: baseDidController,
      };
    } catch (error: any) {
      console.error('Error in WAS storage:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  // Store a resume specifically (wrapper around storeCredential)
  async storeResume(resumeData: any): Promise<StorageResult> {
    return this.storeCredential(resumeData, 'resume');
  }

  // Store a verifiable credential specifically
  async storeVC(vcData: any): Promise<StorageResult> {
    return this.storeCredential(vcData, 'vc');
  }

  // Fetch a list of all credentials
  async getAllCredentials() {
    // This is a placeholder for the actual implementation
  }

  // Delete a credential
  async deleteCredential(spaceId: string, resourceId: string): Promise<boolean> {
    try {
      const appDidSigner = await Ed25519Signer.generate();
      
      const space = await WalletStorage.provisionSpace({
        url: 'https://data.pub',
        signer: appDidSigner,
        id: spaceId as `urn:uuid:${string}`,
      });
      
      const resource = space.resource(resourceId);
      await resource.delete();
      
      return true;
    } catch (error) {
      console.error('Error deleting credential:', error);
      return false;
    }
  }
}

// Export as a singleton
export const walletStorageService = new WalletStorageService();

export default walletStorageService;