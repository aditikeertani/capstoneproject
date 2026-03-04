import torch
import torch.nn as nn

class ConvBlock(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size, stride, padding):
        super(ConvBlock, self).__init__()
        self.conv = nn.Conv2d(in_channels, out_channels, kernel_size, stride, padding)
        self.bn = nn.BatchNorm2d(out_channels)
        self.relu = nn.ReLU()

    def forward(self, x):
        return self.relu(self.bn(self.conv(x)))

class Backbone(nn.Module):
    def __init__(self):
        super(Backbone, self).__init__()
        self.layers = nn.Sequential(
            ConvBlock(3, 32, kernel_size=3, stride=1, padding=1),
            nn.MaxPool2d(2, 2), # 224 -> 112
            ConvBlock(32, 64, kernel_size=3, stride=1, padding=1),
            nn.MaxPool2d(2, 2), # 112 -> 56
            ConvBlock(64, 128, kernel_size=3, stride=1, padding=1),
            nn.MaxPool2d(2, 2), # 56 -> 28
            # --- New Layers ---
            ConvBlock(128, 256, kernel_size=3, stride=1, padding=1),
            nn.MaxPool2d(2, 2), # 28 -> 14
            ConvBlock(256, 512, kernel_size=3, stride=1, padding=1),
            nn.MaxPool2d(2, 2)  # 14 -> 7
        )

    def forward(self, x):
        return self.layers(x)

class Classifier(nn.Module):
    def __init__(self, num_classes):
        super(Classifier, self).__init__()
        self.backbone = Backbone()
        self.avgpool = nn.AdaptiveAvgPool2d((1, 1))
        # Changed from 128 to 512 to match the new Backbone output
        self.fc = nn.Linear(512, num_classes) 

    def forward(self, x):
        x = self.backbone(x)
        x = self.avgpool(x)
        x = torch.flatten(x, 1)
        return self.fc(x)