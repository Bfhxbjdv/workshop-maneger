@echo off
cd /d "C:\Users\HP\Desktop\موقع لتنظيم المهام على الشبكة"
node database\backup.js >> logs\backup.log 2>&1
