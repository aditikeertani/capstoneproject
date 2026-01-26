import torch
import torch.nn as nn

class ConvBlock(nn.Module):
    """A block of Conv2D -> BatchNorm -> ReLU."""
    def __init__(self, in_channels, out_channels, kernel_size, stride, padding):
        super(ConvBlock, self).__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, kernel_size, stride, padding)
        self.bn = nn.BatchNorm2d(out_channels)
        self.relu = nn.ReLU()

    def forward(self, x):
        return self.relu(self.bn(self.conv(x)))

class YOLOBackbone(nn.Module):
    def __init__(self):
        super(YOLOBackbone, self).__init__()
        self.layers = nn.Sequential(
            ConvBlock(3, 32, kernel_size=3, stride=1, padding=1),
            nn.MaxPool2d(2, 2),
            ConvBlock(32, 64, kernel_size=3, stride=1, padding=1),
            nn.MaxPool2d(2, 2),
            ConvBlock(64, 128, kernel_size=3, stride=1, padding=1),
            nn.MaxPool2d(2, 2)
        )

    def forward(self, x):
        return self.layers(x)

class Classifier(nn.Module):
    def __init__(self, num_classes): # Default to 4 states
        super(Classifier, self).__init__()
        
        # 1. Use the existing backbone to extract features
        self.backbone = YOLOBackbone()
        
        # 2. THE SQUASHER (Global Average Pooling)
        # Turns the 80x80 grid of features into a 1x1 summary.
        # This destroys spatial info (Where) but keeps content info (What).
        self.avgpool = nn.AdaptiveAvgPool2d((1, 1))
        
        # 3. THE MENU PICKER (Fully Connected Layer)
        # Takes the 128 summary features and outputs 4 scores.
        self.fc = nn.Linear(128, num_classes)

    def forward(self, x):
        # 1. Extract Features
        # Input: (Batch, 3, 640, 640) -> Output: (Batch, 128, 80, 80)
        x = self.backbone(x)
        
        # 2. Squash to Summary
        # Output: (Batch, 128, 1, 1)
        x = self.avgpool(x)
        
        # 3. Flatten
        # Output: (Batch, 128) - A simple list of 128 numbers per image
        x = torch.flatten(x, 1)
        
        # 4. Classify
        # Output: (Batch, 4) - Raw scores for [Occupied, Unattended, Unoccupied, None]
        return self.fc(x)
        
        # Note: We REMOVED torch.sigmoid.
        # In classification, the training loss function (CrossEntropy) 
        # prefers raw numbers (logits), not 0-1 probabilities.